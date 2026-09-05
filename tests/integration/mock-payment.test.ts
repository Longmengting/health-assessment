import { PrismaClient } from "@prisma/client";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { resetTestDatabase } from "../helpers/database";

const configuredTestDatabaseUrl = process.env.TEST_DATABASE_URL;
const hasProtectedTestDatabase = (() => {
  if (!configuredTestDatabaseUrl) return false;

  try {
    const databasePath = decodeURIComponent(
      new URL(configuredTestDatabaseUrl).pathname,
    ).toLowerCase();

    return ["_test", "-test", "/test", "test_"].some((marker) =>
      databasePath.includes(marker),
    );
  } catch {
    return false;
  }
})();

const testDatabaseUrl =
  configuredTestDatabaseUrl ??
  "postgresql://invalid:invalid@localhost:5432/invalid_test";
const now = new Date("2026-01-01T00:00:00.000Z");
const callback = {
  eventId: "evt_1234",
  sessionId: "",
  status: "paid" as const,
};

describe.skipIf(!hasProtectedTestDatabase)("mock payment persistence", () => {
  const testPrisma = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  let activateMockSubscription: typeof import("../../src/features/payment/payment-service").activateMockSubscription;

  async function removeSubscriptionFailureTrigger() {
    await testPrisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS "task8_reject_subscription_write" ON "Subscription"',
    );
    await testPrisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS "task8_reject_subscription_write"()',
    );
  }

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl);
    ({ activateMockSubscription } = await import(
      "../../src/features/payment/payment-service"
    ));
    await testPrisma.$connect();
  });

  beforeEach(async () => {
    await removeSubscriptionFailureTrigger();
    await resetTestDatabase();
  });

  afterEach(async () => {
    await removeSubscriptionFailureTrigger();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
    vi.unstubAllEnvs();
  });

  async function completedSession() {
    return testPrisma.assessmentSession.create({
      data: {
        tokenHash: crypto.randomUUID(),
        status: "COMPLETED",
        completedAt: now,
        subscription: { create: { status: "INACTIVE" } },
        result: {
          create: {
            algorithmVersion: "1.0.0",
            bmi: 24.7,
            dailyCalories: 2319,
            bmiCategory: "normal",
            estimatedTargetDate: new Date("2026-06-25T00:00:00.000Z"),
            protectedData: {
              basalMetabolicRate: 1780,
              totalDailyEnergyExpenditure: 2759,
              weeklyWeightChangeKg: -0.4,
              disclaimer: "Educational estimate only.",
              predictionCurve: [],
            },
          },
        },
      },
    });
  }

  it("records a successful event and activates the completed session for 30 days", async () => {
    const session = await completedSession();

    const outcome = await activateMockSubscription({
      ...callback,
      sessionId: session.id,
      now,
    });

    expect(outcome).toEqual({
      eventId: callback.eventId,
      sessionId: session.id,
      subscriptionStatus: "ACTIVE",
      activatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-31T00:00:00.000Z",
      replayed: false,
    });
    await expect(
      testPrisma.paymentEvent.findUniqueOrThrow({
        where: { eventId: callback.eventId },
      }),
    ).resolves.toMatchObject({
      sessionId: session.id,
      status: "SUCCEEDED",
      payload: {
        eventId: callback.eventId,
        sessionId: session.id,
        status: "paid",
      },
    });
    await expect(
      testPrisma.subscription.findUniqueOrThrow({
        where: { sessionId: session.id },
      }),
    ).resolves.toMatchObject({
      status: "ACTIVE",
      provider: "MOCK",
      externalPaymentId: callback.eventId,
      activatedAt: now,
      expiresAt: new Date("2026-01-31T00:00:00.000Z"),
    });
  });

  it("replays the same event without duplicating it or changing activation dates", async () => {
    const session = await completedSession();
    const input = { ...callback, sessionId: session.id };

    const first = await activateMockSubscription({ ...input, now });
    const replay = await activateMockSubscription({
      ...input,
      now: new Date("2026-04-01T00:00:00.000Z"),
    });

    expect(replay).toEqual({ ...first, replayed: true });
    await expect(
      testPrisma.paymentEvent.count({ where: { eventId: callback.eventId } }),
    ).resolves.toBe(1);
    await expect(
      testPrisma.subscription.findUniqueOrThrow({
        where: { sessionId: session.id },
      }),
    ).resolves.toMatchObject({
      activatedAt: now,
      expiresAt: new Date("2026-01-31T00:00:00.000Z"),
    });
  });

  it("rejects reuse of an event ID for another session", async () => {
    const firstSession = await completedSession();
    const secondSession = await completedSession();
    await activateMockSubscription({
      ...callback,
      sessionId: firstSession.id,
      now,
    });

    await expect(
      activateMockSubscription({
        ...callback,
        sessionId: secondSession.id,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_EVENT_CONFLICT",
      status: 409,
    });
    await expect(
      testPrisma.paymentEvent.count({ where: { eventId: callback.eventId } }),
    ).resolves.toBe(1);
    await expect(
      testPrisma.subscription.findUniqueOrThrow({
        where: { sessionId: secondSession.id },
      }),
    ).resolves.toMatchObject({ status: "INACTIVE", activatedAt: null });
  });

  it("rejects an event ID whose stored callback status differs", async () => {
    const session = await completedSession();
    await testPrisma.paymentEvent.create({
      data: {
        eventId: callback.eventId,
        sessionId: session.id,
        status: "SUCCEEDED",
        payload: {
          eventId: callback.eventId,
          sessionId: session.id,
          status: "refunded",
        },
      },
    });

    await expect(
      activateMockSubscription({
        ...callback,
        sessionId: session.id,
        now,
      }),
    ).rejects.toMatchObject({
      code: "PAYMENT_EVENT_CONFLICT",
      status: 409,
    });
    await expect(
      testPrisma.subscription.findUniqueOrThrow({
        where: { sessionId: session.id },
      }),
    ).resolves.toMatchObject({ status: "INACTIVE", activatedAt: null });
  });

  it("returns 404 for a missing session without recording an event", async () => {
    await expect(
      activateMockSubscription({
        ...callback,
        sessionId: "11111111-1111-4111-8111-111111111111",
        now,
      }),
    ).rejects.toMatchObject({ code: "SESSION_NOT_FOUND", status: 404 });
    await expect(testPrisma.paymentEvent.count()).resolves.toBe(0);
  });

  it.each([
    { label: "a draft session", completed: false },
    { label: "a completed session with no result", completed: true },
  ])("returns ASSESSMENT_INCOMPLETE for $label", async ({ completed }) => {
    const session = await testPrisma.assessmentSession.create({
      data: {
        tokenHash: crypto.randomUUID(),
        status: completed ? "COMPLETED" : "DRAFT",
        completedAt: completed ? now : null,
        subscription: { create: { status: "INACTIVE" } },
      },
    });

    await expect(
      activateMockSubscription({
        ...callback,
        sessionId: session.id,
        now,
      }),
    ).rejects.toMatchObject({
      code: "ASSESSMENT_INCOMPLETE",
      status: 422,
    });
    await expect(testPrisma.paymentEvent.count()).resolves.toBe(0);
  });

  it("rolls back the payment event when the subscription write fails", async () => {
    const session = await completedSession();
    await testPrisma.$executeRawUnsafe(`
      CREATE FUNCTION "task8_reject_subscription_write"() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'forced subscription failure';
      END;
      $$ LANGUAGE plpgsql
    `);
    await testPrisma.$executeRawUnsafe(`
      CREATE TRIGGER "task8_reject_subscription_write"
      BEFORE INSERT OR UPDATE ON "Subscription"
      FOR EACH ROW EXECUTE FUNCTION "task8_reject_subscription_write"()
    `);

    await expect(
      activateMockSubscription({
        ...callback,
        sessionId: session.id,
        now,
      }),
    ).rejects.toBeDefined();

    await expect(testPrisma.paymentEvent.count()).resolves.toBe(0);
    await expect(
      testPrisma.subscription.findUniqueOrThrow({
        where: { sessionId: session.id },
      }),
    ).resolves.toMatchObject({
      status: "INACTIVE",
      externalPaymentId: null,
      activatedAt: null,
      expiresAt: null,
    });
  });
});
