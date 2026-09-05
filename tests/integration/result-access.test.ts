import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
const protectedResultKeys = [
  "recommendedDailyCalories",
  "basalMetabolicRate",
  "totalDailyEnergyExpenditure",
  "estimatedTargetDate",
  "weeklyWeightChangeKg",
  "predictionCurve",
] as const;
const disclaimer =
  "This educational estimate is not medical advice. Consult a qualified health professional for personalized guidance.";

function recursiveObjectKeys(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => recursiveObjectKeys(entry));
  }
  if (value === null || typeof value !== "object") return [];

  return Object.entries(value).flatMap(([key, entry]) => [
    key,
    ...recursiveObjectKeys(entry),
  ]);
}

describe.skipIf(!hasProtectedTestDatabase)("result access", () => {
  const testPrisma = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  let createSession: typeof import("../../src/features/assessment/session-service").createSession;
  let sessionCookieName: typeof import("../../src/lib/session-token").sessionCookieName;
  let GET: typeof import("../../src/app/api/sessions/[id]/result/route").GET;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl);

    ({ createSession } = await import(
      "../../src/features/assessment/session-service"
    ));
    ({ sessionCookieName } = await import("../../src/lib/session-token"));
    ({ GET } = await import("../../src/app/api/sessions/[id]/result/route"));
    await testPrisma.$connect();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
    vi.unstubAllEnvs();
  });

  async function sessionRequest(sessionId: string, token: string, query = "") {
    return new Request(
      `http://localhost/api/sessions/${sessionId}/result${query}`,
      {
        headers: {
          cookie: `${sessionCookieName(sessionId)}=${token}`,
        },
      },
    );
  }

  async function persistedResultFixture({
    status,
    expiresAt,
    query = "",
  }: {
    status: "INACTIVE" | "ACTIVE" | "EXPIRED";
    expiresAt: Date | null;
    query?: string;
  }) {
    const { session, token } = await createSession();

    await testPrisma.assessmentSession.update({
      where: { id: session.id },
      data: {
        status: "COMPLETED",
        completedAt: new Date("2026-01-01T12:00:00.000Z"),
      },
    });
    await testPrisma.subscription.update({
      where: { sessionId: session.id },
      data: { status, expiresAt },
    });
    const result = await testPrisma.assessmentResult.create({
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
          disclaimer,
          predictionCurve: [
            { date: "2026-01-08", weightKg: 79.6 },
            { date: "2026-01-15", weightKg: 79.2 },
          ],
        },
      },
    });

    return {
      request: await sessionRequest(session.id, token, query),
      result,
      session,
    };
  }

  async function getResult(request: Request, sessionId: string) {
    const response = await GET(request, {
      params: Promise.resolve({ id: sessionId }),
    });

    return { response, envelope: await response.json() };
  }

  it("returns preview data for an inactive subscription despite forged claims", async () => {
    const { request, result, session } = await persistedResultFixture({
      status: "INACTIVE",
      expiresAt: null,
      query: "?access=premium&subscriptionStatus=ACTIVE",
    });

    const { response, envelope } = await getResult(request, session.id);

    expect(response.status).toBe(200);
    expect(Object.keys(envelope.data).sort()).toEqual(
      [
        "access",
        "id",
        "bmi",
        "bmiCategory",
        "summary",
        "lockedFeatures",
        "upgradeRequired",
        "disclaimer",
      ].sort(),
    );
    expect(envelope.data).toMatchObject({
      access: "preview",
      id: result.id,
      bmi: 24.7,
      bmiCategory: "normal",
      lockedFeatures: protectedResultKeys,
      upgradeRequired: true,
      disclaimer,
    });
    const responseKeys = recursiveObjectKeys(envelope.data);
    for (const protectedKey of protectedResultKeys) {
      expect(responseKeys).not.toContain(protectedKey);
    }
  });

  it("returns every premium result field for an active unexpired subscription", async () => {
    const { request, result, session } = await persistedResultFixture({
      status: "ACTIVE",
      expiresAt: new Date("2100-01-01T00:00:00.000Z"),
    });

    const { response, envelope } = await getResult(request, session.id);

    expect(response.status).toBe(200);
    expect(envelope.data).toEqual({
      access: "premium",
      id: result.id,
      bmi: 24.7,
      bmiCategory: "normal",
      recommendedDailyCalories: 2319,
      basalMetabolicRate: 1780,
      totalDailyEnergyExpenditure: 2759,
      estimatedTargetDate: "2026-06-25",
      weeklyWeightChangeKg: -0.4,
      predictionCurve: [
        { date: "2026-01-08", weightKg: 79.6 },
        { date: "2026-01-15", weightKg: 79.2 },
      ],
      disclaimer,
      upgradeRequired: false,
    });

    const responseKeys = recursiveObjectKeys(envelope);
    for (const internalKey of [
      "tokenHash",
      "subscription",
      "protectedData",
      "session",
      "sessionId",
      "algorithmVersion",
      "dailyCalories",
      "provider",
      "externalPaymentId",
      "expiresAt",
    ]) {
      expect(responseKeys).not.toContain(internalKey);
    }
  });

  it.each([
    {
      label: "an explicitly expired subscription",
      status: "EXPIRED" as const,
      expiresAt: new Date("2100-01-01T00:00:00.000Z"),
    },
    {
      label: "an active subscription whose expiry is in the past",
      status: "ACTIVE" as const,
      expiresAt: new Date("2000-01-01T00:00:00.000Z"),
    },
  ])("returns preview data for $label", async ({ status, expiresAt }) => {
    const { request, session } = await persistedResultFixture({
      status,
      expiresAt,
    });

    const { response, envelope } = await getResult(request, session.id);

    expect(response.status).toBe(200);
    expect(envelope.data.access).toBe("preview");
    expect(envelope.data.upgradeRequired).toBe(true);
  });

  it("returns a typed 404 when the authenticated session has no result", async () => {
    const { session, token } = await createSession();
    const request = await sessionRequest(session.id, token);

    const { response, envelope } = await getResult(request, session.id);

    expect(response.status).toBe(404);
    expect(envelope).toEqual({
      error: {
        code: "RESULT_NOT_FOUND",
        message: "The assessment result was not found.",
      },
      meta: { requestId: expect.any(String) },
    });
  });
});
