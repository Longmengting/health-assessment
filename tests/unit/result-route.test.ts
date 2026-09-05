import { beforeEach, describe, expect, it, vi } from "vitest";

const getAuthorizedResultMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/features/assessment/result-policy", () => ({
  getAuthorizedResult: getAuthorizedResultMock,
}));

import { GET } from "../../src/app/api/sessions/[id]/result/route";
import { AppError } from "../../src/lib/api-response";

describe("result route", () => {
  beforeEach(() => {
    getAuthorizedResultMock.mockReset();
  });

  it("returns only the authorized result in the success envelope", async () => {
    const authorizedResult = {
      access: "preview",
      id: "result-1",
      bmi: 24.7,
      bmiCategory: "normal",
      summary: "Your BMI is 24.7, which is in the normal range.",
      lockedFeatures: [
        "recommendedDailyCalories",
        "basalMetabolicRate",
        "totalDailyEnergyExpenditure",
        "estimatedTargetDate",
        "weeklyWeightChangeKg",
        "predictionCurve",
      ],
      upgradeRequired: true,
      disclaimer: "Educational estimate only.",
    };
    getAuthorizedResultMock.mockResolvedValue(authorizedResult);
    const request = new Request(
      "http://localhost/api/sessions/session-1/result?access=premium",
    );

    const response = await GET(request, {
      params: Promise.resolve({ id: "session-1" }),
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: authorizedResult,
      meta: { requestId: expect.any(String) },
    });
    expect(getAuthorizedResultMock).toHaveBeenCalledWith(request, "session-1");
  });

  it("maps result policy errors through the shared failure envelope", async () => {
    getAuthorizedResultMock.mockRejectedValue(
      new AppError(
        "RESULT_NOT_FOUND",
        "The assessment result was not found.",
        404,
      ),
    );

    const response = await GET(
      new Request("http://localhost/api/sessions/missing/result"),
      { params: Promise.resolve({ id: "missing" }) },
    );

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "RESULT_NOT_FOUND",
        message: "The assessment result was not found.",
      },
      meta: { requestId: expect.any(String) },
    });
  });
});
