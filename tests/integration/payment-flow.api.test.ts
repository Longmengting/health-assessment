import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { resetTestDatabase } from "../helpers/database";

const configuredTestDatabaseUrl = process.env.TEST_DATABASE_URL;
const hasProtectedTestDatabase = (() => {
  if (!configuredTestDatabaseUrl) return false;

  try {
    const path = decodeURIComponent(
      new URL(configuredTestDatabaseUrl).pathname,
    ).toLowerCase();
    return ["_test", "-test", "/test", "test_"].some((marker) =>
      path.includes(marker),
    );
  } catch {
    return false;
  }
})();

const testDatabaseUrl =
  configuredTestDatabaseUrl ??
  "postgresql://invalid:invalid@localhost:5432/invalid_test";
const paymentSecret = "task8-api-flow-payment-secret-123";
const protectedKeys = [
  "recommendedDailyCalories",
  "basalMetabolicRate",
  "totalDailyEnergyExpenditure",
  "estimatedTargetDate",
  "weeklyWeightChangeKg",
  "predictionCurve",
] as const;

function recursiveObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap(recursiveObjectKeys);
  }
  if (value === null || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, entry]) => [
    key,
    ...recursiveObjectKeys(entry),
  ]);
}

describe.skipIf(!hasProtectedTestDatabase)("payment API flow", () => {
  const testPrisma = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  let createSession: typeof import("../../src/features/assessment/session-service").createSession;
  let sessionCookieName: typeof import("../../src/lib/session-token").sessionCookieName;
  let resultGET: typeof import("../../src/app/api/sessions/[id]/result/route").GET;
  let paymentPOST: typeof import("../../src/app/api/payments/mock/route").POST;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl);
    vi.stubEnv("MOCK_PAYMENT_SECRET", paymentSecret);
    ({ createSession } = await import(
      "../../src/features/assessment/session-service"
    ));
    ({ sessionCookieName } = await import("../../src/lib/session-token"));
    ({ GET: resultGET } = await import(
      "../../src/app/api/sessions/[id]/result/route"
    ));
    ({ POST: paymentPOST } = await import(
      "../../src/app/api/payments/mock/route"
    ));
    await testPrisma.$connect();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it("keeps result details locked until an authenticated payment callback succeeds", async () => {
    const { session, token } = await createSession();
    await testPrisma.assessmentSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", completedAt: new Date() },
    });
    await testPrisma.assessmentResult.create({
      data: {
        sessionId: session.id,
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
          predictionCurve: [{ date: "2026-01-08", weightKg: 79.6 }],
        },
      },
    });
    const resultRequest = () =>
      new Request(`http://localhost/api/sessions/${session.id}/result`, {
        headers: {
          cookie: `${sessionCookieName(session.id)}=${token}`,
        },
      });

    const previewResponse = await resultGET(resultRequest(), {
      params: Promise.resolve({ id: session.id }),
    });
    const previewEnvelope = await previewResponse.json();

    expect(previewResponse.status).toBe(200);
    expect(previewEnvelope.data.access).toBe("preview");
    const previewKeys = recursiveObjectKeys(previewEnvelope.data);
    for (const protectedKey of protectedKeys) {
      expect(previewKeys).not.toContain(protectedKey);
    }

    const paymentResponse = await paymentPOST(
      new Request("http://localhost/api/payments/mock", {
        method: "POST",
        headers: {
          authorization: `Bearer ${paymentSecret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          eventId: "evt_flow_1",
          sessionId: session.id,
          status: "paid",
        }),
      }),
    );
    const paymentEnvelope = await paymentResponse.json();

    expect(paymentResponse.status).toBe(200);
    expect(paymentEnvelope.data).toMatchObject({
      eventId: "evt_flow_1",
      sessionId: session.id,
      subscriptionStatus: "ACTIVE",
      replayed: false,
    });

    const premiumResponse = await resultGET(resultRequest(), {
      params: Promise.resolve({ id: session.id }),
    });
    const premiumEnvelope = await premiumResponse.json();

    expect(premiumResponse.status).toBe(200);
    expect(premiumEnvelope.data).toEqual({
      access: "premium",
      id: expect.any(String),
      bmi: 24.7,
      bmiCategory: "normal",
      recommendedDailyCalories: 2319,
      basalMetabolicRate: 1780,
      totalDailyEnergyExpenditure: 2759,
      estimatedTargetDate: "2026-06-25",
      weeklyWeightChangeKg: -0.4,
      predictionCurve: [{ date: "2026-01-08", weightKg: 79.6 }],
      disclaimer: "Educational estimate only.",
      upgradeRequired: false,
    });
  });
});
