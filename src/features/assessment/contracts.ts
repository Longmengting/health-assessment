import { z } from "zod";

import type {
  ActivityStepPayload,
  AssessmentInput,
  BodyStepPayload,
  GenderStepPayload,
  GoalStepPayload,
  StepName,
  StepPayloadByName,
} from "./types";

const finiteNumber = z.number().finite();

const genderSchema: z.ZodType<GenderStepPayload> = z
  .object({ gender: z.enum(["male", "female"]) })
  .strict();
const goalSchema: z.ZodType<GoalStepPayload> = z
  .object({ goal: z.enum(["lose", "maintain", "gain"]) })
  .strict();
const bodySchema: z.ZodType<BodyStepPayload> = z
  .object({
    age: finiteNumber.int().min(18).max(80),
    heightCm: finiteNumber.min(120).max(230),
    weightKg: finiteNumber.min(35).max(300),
    targetWeightKg: finiteNumber.min(35).max(300),
  })
  .strict()
  .superRefine(({ weightKg, targetWeightKg }, context) => {
    if (Math.abs(targetWeightKg - weightKg) > weightKg * 0.4) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetWeightKg"],
        message: "Target weight change cannot exceed 40% of current weight",
      });
    }
  });
const activitySchema: z.ZodType<ActivityStepPayload> = z
  .object({
    activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  })
  .strict();

const stepSchemas = {
  gender: genderSchema,
  goal: goalSchema,
  body: bodySchema,
  activity: activitySchema,
} satisfies Record<StepName, z.ZodType<StepPayloadByName[StepName]>>;

export const assessmentInputSchema: z.ZodType<AssessmentInput> = z
  .object({
    gender: z.enum(["male", "female"]),
    goal: z.enum(["lose", "maintain", "gain"]),
    age: finiteNumber.int().min(18).max(80),
    heightCm: finiteNumber.min(120).max(230),
    weightKg: finiteNumber.min(35).max(300),
    targetWeightKg: finiteNumber.min(35).max(300),
    activityLevel: z.enum(["sedentary", "light", "moderate", "active", "very_active"]),
  })
  .strict()
  .superRefine(({ goal, weightKg, targetWeightKg }, context) => {
    if (Math.abs(targetWeightKg - weightKg) > weightKg * 0.4) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetWeightKg"],
        message: "Target weight change cannot exceed 40% of current weight",
      });
    }

    const hasExpectedDirection =
      (goal === "lose" && targetWeightKg < weightKg) ||
      (goal === "gain" && targetWeightKg > weightKg) ||
      (goal === "maintain" && Math.abs(targetWeightKg - weightKg) <= 0.1);

    if (!hasExpectedDirection) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["targetWeightKg"],
        message: "Target weight is inconsistent with the selected goal",
      });
    }
  });

export function parseStepPayload<T extends StepName>(
  step: T,
  value: unknown,
): StepPayloadByName[T] {
  return stepSchemas[step].parse(value) as StepPayloadByName[T];
}
