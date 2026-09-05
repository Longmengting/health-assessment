import { beforeEach, describe, expect, it, vi } from "vitest";

const submitAssessmentMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/features/assessment/session-service", () => ({
  submitAssessment: submitAssessmentMock,
}));

import { POST } from "../../src/app/api/sessions/[id]/submit/route";

describe("assessment submit route contract", () => {
  beforeEach(() => {
    submitAssessmentMock.mockReset();
  });

  it("rejects a non-empty request body", async () => {
    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/submit", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ expectedVersion: 4 }),
      }),
      { params: Promise.resolve({ id: "session-1" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        fields: { body: ["Submit requests must not include a body."] },
      },
      meta: { requestId: expect.any(String) },
    });
  });

  it("returns only explicitly allowlisted result metadata", async () => {
    submitAssessmentMock.mockResolvedValue({
      id: "result-1",
      sessionId: "session-1",
      algorithmVersion: "1.0.0",
      bmi: 24.7,
      bmiCategory: "normal",
      createdAt: "2026-01-01T00:00:00.000Z",
      dailyCalories: 2319,
      estimatedTargetDate: "2026-06-25T00:00:00.000Z",
      protectedData: {
        basalMetabolicRate: 1780,
        totalDailyEnergyExpenditure: 2759,
      },
      tokenHash: "must-not-leak",
      subscription: { status: "INACTIVE" },
    });

    const response = await POST(
      new Request("http://localhost/api/sessions/session-1/submit", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "session-1" }) },
    );
    const envelope = await response.json();

    expect(response.status).toBe(200);
    expect(envelope).toEqual({
      data: {
        id: "result-1",
        sessionId: "session-1",
        algorithmVersion: "1.0.0",
        bmi: 24.7,
        bmiCategory: "normal",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      meta: { requestId: expect.any(String) },
    });
    expect(JSON.stringify(envelope)).not.toMatch(
      /tokenHash|subscription|dailyCalories|estimatedTargetDate|protectedData|basalMetabolicRate|totalDailyEnergyExpenditure/,
    );
  });
});
