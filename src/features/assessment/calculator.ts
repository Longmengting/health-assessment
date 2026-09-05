import { assessmentInputSchema } from "./contracts";
import type {
  AssessmentCalculation,
  AssessmentInput,
  BmiCategory,
  PredictionPoint,
} from "./types";

const ACTIVITY_FACTORS = {
  sedentary: 1.2,
  light: 1.375,
  moderate: 1.55,
  active: 1.725,
  very_active: 1.9,
} as const;
const KCAL_PER_KG = 7700;
const MAX_WEEKLY_CHANGE_KG = 1;
const MAX_DAILY_ADJUSTMENT = 750;
const FEMALE_MINIMUM_CALORIES = 1200;
const MALE_MINIMUM_CALORIES = 1500;
const EDUCATIONAL_DISCLAIMER =
  "This educational estimate is not medical advice. Consult a qualified health professional for personalized guidance.";

function roundToOneDecimal(value: number) {
  return Math.round((value + Number.EPSILON) * 10) / 10;
}

function dateAtUtcMidnight(date: Date) {
  if (Number.isNaN(date.getTime())) {
    throw new RangeError("today must be a valid date");
  }

  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function addUtcWeeks(date: Date, weeks: number) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + weeks * 7);
  return result;
}

function toIsoDate(date: Date) {
  return date.toISOString().slice(0, 10);
}

function categoryFor(bmi: number): BmiCategory {
  if (bmi < 18.5) return "underweight";
  if (bmi < 25) return "normal";
  if (bmi < 30) return "overweight";
  return "obese";
}

function buildPredictionCurve(
  startDate: Date,
  input: AssessmentInput,
  internalWeeklyWeightChangeKg: number,
): PredictionPoint[] {
  return Array.from({ length: 12 }, (_, index) => {
    const week = index + 1;
    const unconstrainedWeight = input.weightKg + internalWeeklyWeightChangeKg * week;
    const weightKg =
      internalWeeklyWeightChangeKg < 0
        ? Math.max(input.targetWeightKg, unconstrainedWeight)
        : internalWeeklyWeightChangeKg > 0
          ? Math.min(input.targetWeightKg, unconstrainedWeight)
          : input.weightKg;

    return {
      date: toIsoDate(addUtcWeeks(startDate, week)),
      weightKg: roundToOneDecimal(weightKg),
    };
  });
}

export function calculateAssessment(input: AssessmentInput, today: Date): AssessmentCalculation {
  const validInput = assessmentInputSchema.parse(input);
  const startDate = dateAtUtcMidnight(today);
  const heightMetres = validInput.heightCm / 100;
  const bmi = validInput.weightKg / heightMetres ** 2;
  const basalMetabolicRate =
    10 * validInput.weightKg +
    6.25 * validInput.heightCm -
    5 * validInput.age +
    (validInput.gender === "male" ? 5 : -161);
  const totalDailyEnergyExpenditure =
    basalMetabolicRate * ACTIVITY_FACTORS[validInput.activityLevel];
  const baseWeeklyChange = Math.min(validInput.weightKg * 0.005, MAX_WEEKLY_CHANGE_KG);
  const dailyAdjustment = Math.min(
    (baseWeeklyChange * KCAL_PER_KG) / 7,
    MAX_DAILY_ADJUSTMENT,
  );
  const direction = validInput.goal === "lose" ? -1 : validInput.goal === "gain" ? 1 : 0;
  const minimumCalories =
    validInput.gender === "female" ? FEMALE_MINIMUM_CALORIES : MALE_MINIMUM_CALORIES;
  const recommendedDailyCalories =
    direction === 0
      ? Math.round(totalDailyEnergyExpenditure)
      : Math.max(
          minimumCalories,
          Math.round(totalDailyEnergyExpenditure + direction * dailyAdjustment),
        );
  const internalWeeklyWeightChangeKg = direction * baseWeeklyChange;
  const weeklyWeightChangeKg = roundToOneDecimal(internalWeeklyWeightChangeKg);
  const weightDelta = Math.abs(validInput.targetWeightKg - validInput.weightKg);
  const estimatedWeeks = direction === 0 ? 0 : Math.ceil(weightDelta / baseWeeklyChange);

  return {
    bmi: roundToOneDecimal(bmi),
    bmiCategory: categoryFor(bmi),
    basalMetabolicRate: Math.round(basalMetabolicRate),
    totalDailyEnergyExpenditure: Math.round(totalDailyEnergyExpenditure),
    recommendedDailyCalories,
    estimatedTargetDate: direction === 0 ? null : toIsoDate(addUtcWeeks(startDate, estimatedWeeks)),
    weeklyWeightChangeKg,
    disclaimer: EDUCATIONAL_DISCLAIMER,
    predictionCurve: buildPredictionCurve(startDate, validInput, internalWeeklyWeightChangeKg),
  };
}
