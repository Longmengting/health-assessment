import { Prisma } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requireSessionAccessMock = vi.hoisted(() => vi.fn());
const findUniqueMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/features/assessment/session-service", () => ({
  requireSessionAccess: requireSessionAccessMock,
}));

vi.mock("../../src/lib/prisma", () => ({
  prisma: {
    assessmentResult: {
      findUnique: findUniqueMock,
    },
  },
}));

import {
  PROTECTED_RESULT_KEYS,
  buildPremiumResult,
  buildPreviewResult,
  getAuthorizedResult,
} from "../../src/features/assessment/result-policy";
import { AppError } from "../../src/lib/api-response";

const disclaimer =
  "This educational estimate is not medical advice. Consult a qualified health professional for personalized guidance.";

function storedResult(overrides: Record<string, unknown> = {}) {
  return {
    id: "result-1",
    sessionId: "session-1",
    algorithmVersion: "1.0.0",
    bmi: new Prisma.Decimal("24.7"),
    dailyCalories: new Prisma.Decimal("2319"),
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
    createdAt: new Date("2026-01-01T12:00:00.000Z"),
    ...overrides,
  };
}

function authorizedStoredResult(
  subscription: {
    status: "INACTIVE" | "ACTIVE" | "EXPIRED";
    expiresAt: Date | null;
  } | null,
) {
  return {
    ...storedResult(),
    session: { subscription },
  };
}

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

describe("assessment result policy", () => {
  beforeEach(() => {
    requireSessionAccessMock.mockReset();
    requireSessionAccessMock.mockResolvedValue({ id: "session-1" });
    findUniqueMock.mockReset();
  });

  it("builds an exact preview allowlist with no protected property at any depth", () => {
    const preview = buildPreviewResult(storedResult());

    expect(Object.keys(preview).sort()).toEqual(
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
    expect(preview).toMatchObject({
      access: "preview",
      id: "result-1",
      bmi: 24.7,
      bmiCategory: "normal",
      summary: expect.stringContaining("24.7"),
      lockedFeatures: [
        "recommendedDailyCalories",
        "basalMetabolicRate",
        "totalDailyEnergyExpenditure",
        "estimatedTargetDate",
        "weeklyWeightChangeKg",
        "predictionCurve",
      ],
      upgradeRequired: true,
      disclaimer,
    });
    expect(preview.summary).toContain("正常");
    expect(preview.lockedFeatures).toEqual(PROTECTED_RESULT_KEYS);

    const previewKeys = recursiveObjectKeys(preview);
    for (const protectedKey of PROTECTED_RESULT_KEYS) {
      expect(previewKeys).not.toContain(protectedKey);
    }
  });

  it("builds an exact premium allowlist with every protected value", () => {
    const premium = buildPremiumResult(storedResult());

    expect(premium).toEqual({
      access: "premium",
      id: "result-1",
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
    expect(Object.keys(premium).sort()).toEqual(
      [
        "access",
        "id",
        "bmi",
        "bmiCategory",
        ...PROTECTED_RESULT_KEYS,
        "disclaimer",
        "upgradeRequired",
      ].sort(),
    );
  });

  it("sanitizes invalid stored protected JSON", () => {
    let thrown: unknown;

    try {
      buildPreviewResult(
        storedResult({
          protectedData: {
            basalMetabolicRate: "database-password=secret",
            totalDailyEnergyExpenditure: 2759,
            weeklyWeightChangeKg: -0.4,
            disclaimer,
            predictionCurve: [],
            internalNote: "database-password=secret",
          },
        }),
      );
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(AppError);
    expect(thrown).toMatchObject({
      code: "RESULT_DATA_INVALID",
      status: 500,
      message: "Stored assessment result data is invalid.",
    });
    expect((thrown as Error).message).not.toContain("database-password");
    expect((thrown as AppError).fields).toBeUndefined();
  });

  it.each([
    {
      label: "an active subscription without an expiry",
      status: "ACTIVE" as const,
      expiresAt: null,
      expectedAccess: "premium",
    },
    {
      label: "an active subscription expiring after now",
      status: "ACTIVE" as const,
      expiresAt: new Date("2026-01-01T00:00:00.001Z"),
      expectedAccess: "premium",
    },
    {
      label: "an active subscription expiring exactly at now",
      status: "ACTIVE" as const,
      expiresAt: new Date("2026-01-01T00:00:00.000Z"),
      expectedAccess: "preview",
    },
    {
      label: "an active subscription that expired before now",
      status: "ACTIVE" as const,
      expiresAt: new Date("2025-12-31T23:59:59.999Z"),
      expectedAccess: "preview",
    },
    {
      label: "an expired subscription with a future expiry",
      status: "EXPIRED" as const,
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      expectedAccess: "preview",
    },
    {
      label: "an inactive subscription",
      status: "INACTIVE" as const,
      expiresAt: null,
      expectedAccess: "preview",
    },
  ])("uses the server-side access boundary for $label", async ({
    status,
    expiresAt,
    expectedAccess,
  }) => {
    findUniqueMock.mockResolvedValue(
      authorizedStoredResult({ status, expiresAt }),
    );
    const request = new Request(
      "http://localhost/api/sessions/session-1/result",
    );

    const result = await getAuthorizedResult(
      request,
      "session-1",
      new Date("2026-01-01T00:00:00.000Z"),
    );

    expect(result.access).toBe(expectedAccess);
  });

  it("does not let forged query or header subscription claims unlock a result", async () => {
    findUniqueMock.mockResolvedValue(
      authorizedStoredResult({ status: "INACTIVE", expiresAt: null }),
    );
    const request = new Request(
      "http://localhost/api/sessions/session-1/result?access=premium&subscriptionStatus=ACTIVE",
      { headers: { "x-subscription-status": "ACTIVE" } },
    );

    const result = await getAuthorizedResult(
      request,
      "session-1",
      new Date("2026-01-01T00:00:00.000Z"),
    );

    expect(result.access).toBe("preview");
    expect(requireSessionAccessMock).toHaveBeenCalledWith(request, "session-1");
    expect(findUniqueMock).toHaveBeenCalledTimes(1);
    expect(findUniqueMock.mock.calls[0]?.[0]).toMatchObject({
      where: { sessionId: "session-1" },
    });
  });
});
