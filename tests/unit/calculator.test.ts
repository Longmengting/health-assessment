import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import { calculateAssessment } from "../../src/features/assessment/calculator";
import type { AssessmentInput } from "../../src/features/assessment/types";

const today = new Date("2026-01-01T15:30:00.000Z");

const losingInput: AssessmentInput = {
  gender: "male",
  goal: "lose",
  age: 30,
  heightCm: 180,
  weightKg: 80,
  targetWeightKg: 70,
  activityLevel: "moderate",
};

describe("calculateAssessment", () => {
  it("calculates a deterministic calorie and date estimate for weight loss", () => {
    expect(calculateAssessment(losingInput, today)).toMatchObject({
      bmi: 24.7,
      bmiCategory: "normal",
      basalMetabolicRate: 1780,
      totalDailyEnergyExpenditure: 2759,
      recommendedDailyCalories: 2319,
      estimatedTargetDate: "2026-06-25",
      weeklyWeightChangeKg: -0.4,
    });
  });

  it("keeps maintenance calories equal to rounded TDEE and omits a target date", () => {
    const result = calculateAssessment(
      {
        gender: "female",
        goal: "maintain",
        age: 35,
        heightCm: 165,
        weightKg: 60,
        targetWeightKg: 60,
        activityLevel: "light",
      },
      today,
    );

    expect(result).toMatchObject({
      bmi: 22,
      bmiCategory: "normal",
      basalMetabolicRate: 1295,
      totalDailyEnergyExpenditure: 1781,
      recommendedDailyCalories: 1781,
      estimatedTargetDate: null,
      weeklyWeightChangeKg: 0,
    });
    expect(result.predictionCurve).toHaveLength(12);
    expect(result.predictionCurve.every((point) => point.weightKg === 60)).toBe(true);
  });

  it.each([
    [50, "underweight"],
    [60, "normal"],
    [75, "overweight"],
    [90, "obese"],
  ] as const)("assigns %s kg to the %s BMI category at 170 cm", (weightKg, bmiCategory) => {
    const result = calculateAssessment(
      {
        gender: "female",
        goal: "maintain",
        age: 30,
        heightCm: 170,
        weightKg,
        targetWeightKg: weightKg,
        activityLevel: "sedentary",
      },
      today,
    );

    expect(result.bmiCategory).toBe(bmiCategory);
  });

  it("applies the female calorie safety floor after a bounded loss adjustment", () => {
    const result = calculateAssessment(
      {
        gender: "female",
        goal: "lose",
        age: 80,
        heightCm: 120,
        weightKg: 100,
        targetWeightKg: 95,
        activityLevel: "sedentary",
      },
      today,
    );

    expect(result.recommendedDailyCalories).toBe(1200);
    expect(result.weeklyWeightChangeKg).toBe(-0.5);
  });

  it("returns twelve weekly points without moving beyond the target", () => {
    const result = calculateAssessment(losingInput, today);

    expect(result.predictionCurve).toHaveLength(12);
    expect(result.predictionCurve[0]).toEqual({ date: "2026-01-08", weightKg: 79.6 });
    expect(result.predictionCurve[11]).toEqual({ date: "2026-03-26", weightKg: 75.2 });
    expect(result.predictionCurve.every((point) => point.weightKg >= 70 && point.weightKg <= 80)).toBe(true);
  });

  it("does not reach a 70 to 66 kg loss target before its twelve-week target date", () => {
    const result = calculateAssessment(
      { ...losingInput, weightKg: 70, targetWeightKg: 66 },
      today,
    );

    expect(result.estimatedTargetDate).toBe("2026-03-26");
    expect(result.predictionCurve.slice(0, -1).every((point) => point.weightKg > 66)).toBe(true);
    expect(result.predictionCurve[11]).toEqual({ date: "2026-03-26", weightKg: 66 });
  });

  it("holds the curve at the target once a short goal is reached", () => {
    const result = calculateAssessment(
      { ...losingInput, weightKg: 100, targetWeightKg: 99 },
      today,
    );

    expect(result.predictionCurve[11].weightKg).toBe(99);
  });

  it("rejects impossible goal direction and invalid clock dates", () => {
    expect(() =>
      calculateAssessment({ ...losingInput, targetWeightKg: 81 }, today),
    ).toThrow(ZodError);
    expect(() => calculateAssessment(losingInput, new Date("not a date"))).toThrow(
      "today must be a valid date",
    );
  });
});
