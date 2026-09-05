export type StepName = "gender" | "goal" | "body" | "activity";

export type Gender = "male" | "female";
export type Goal = "lose" | "maintain" | "gain";
export type ActivityLevel =
  | "sedentary"
  | "light"
  | "moderate"
  | "active"
  | "very_active";

export interface GenderStepPayload {
  gender: Gender;
}

export interface GoalStepPayload {
  goal: Goal;
}

export interface BodyStepPayload {
  age: number;
  heightCm: number;
  weightKg: number;
  targetWeightKg: number;
}

export interface ActivityStepPayload {
  activityLevel: ActivityLevel;
}

export interface StepPayloadByName {
  gender: GenderStepPayload;
  goal: GoalStepPayload;
  body: BodyStepPayload;
  activity: ActivityStepPayload;
}

export interface AssessmentInput
  extends GenderStepPayload,
    GoalStepPayload,
    BodyStepPayload,
    ActivityStepPayload {}

export type BmiCategory = "underweight" | "normal" | "overweight" | "obese";

export interface PredictionPoint {
  date: string;
  weightKg: number;
}

export interface AssessmentCalculation {
  bmi: number;
  bmiCategory: BmiCategory;
  basalMetabolicRate: number;
  totalDailyEnergyExpenditure: number;
  recommendedDailyCalories: number;
  estimatedTargetDate: string | null;
  weeklyWeightChangeKg: number;
  disclaimer: string;
  predictionCurve: PredictionPoint[];
}
