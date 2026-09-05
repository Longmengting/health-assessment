import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  assessmentInputSchema,
  parseStepPayload,
} from "../../src/features/assessment/contracts";

const validAssessmentInput = {
  gender: "female",
  goal: "lose",
  age: 30,
  heightCm: 170,
  weightKg: 70,
  targetWeightKg: 65,
  activityLevel: "moderate",
} as const;

describe("assessment step contracts", () => {
  it("parses the exact payload required for each assessment step", () => {
    expect(parseStepPayload("gender", { gender: "female" })).toEqual({
      gender: "female",
    });
    expect(parseStepPayload("goal", { goal: "lose" })).toEqual({ goal: "lose" });
    expect(
      parseStepPayload("body", {
        age: 30,
        heightCm: 170,
        weightKg: 70,
        targetWeightKg: 65,
      }),
    ).toEqual({ age: 30, heightCm: 170, weightKg: 70, targetWeightKg: 65 });
    expect(parseStepPayload("activity", { activityLevel: "moderate" })).toEqual({
      activityLevel: "moderate",
    });
  });

  it.each([
    ["a missing age", { heightCm: 170, weightKg: 70, targetWeightKg: 65 }],
    ["an age string", { age: "30", heightCm: 170, weightKg: 70, targetWeightKg: 65 }],
    ["an underage value", { age: 17, heightCm: 170, weightKg: 70, targetWeightKg: 65 }],
    ["a fractional age", { age: 30.5, heightCm: 170, weightKg: 70, targetWeightKg: 65 }],
    ["zero height", { age: 30, heightCm: 0, weightKg: 70, targetWeightKg: 65 }],
    ["a negative weight", { age: 30, heightCm: 170, weightKg: -70, targetWeightKg: 65 }],
    [
      "a non-finite height",
      { age: 30, heightCm: Number.POSITIVE_INFINITY, weightKg: 70, targetWeightKg: 65 },
    ],
    ["an implausible target change", { age: 30, heightCm: 170, weightKg: 70, targetWeightKg: 35 }],
  ])("rejects body payload with %s", (_reason, payload) => {
    expect(() => parseStepPayload("body", payload)).toThrow(ZodError);
  });

  it.each([
    ["gender", { gender: "other" }],
    ["goal", { goal: "recompose" }],
    ["activity", { activityLevel: "weekend_warrior" }],
  ] as const)("rejects closed-enum values for the %s step", (step, payload) => {
    expect(() => parseStepPayload(step, payload)).toThrow(ZodError);
  });

  it.each([
    ["gender", { gender: "male", extra: true }],
    ["goal", { goal: "gain", extra: true }],
    ["body", { age: 30, heightCm: 170, weightKg: 70, targetWeightKg: 75, extra: true }],
    ["activity", { activityLevel: "active", extra: true }],
  ] as const)("rejects unknown fields for the %s step", (step, payload) => {
    expect(() => parseStepPayload(step, payload)).toThrow(ZodError);
  });

  it.each([
    ["an unknown field", { ...validAssessmentInput, unexpected: true }],
    ["numeric strings", { ...validAssessmentInput, age: "30", heightCm: "170" }],
    ["NaN", { ...validAssessmentInput, weightKg: Number.NaN }],
    ["positive infinity", { ...validAssessmentInput, targetWeightKg: Number.POSITIVE_INFINITY }],
    ["negative infinity", { ...validAssessmentInput, targetWeightKg: Number.NEGATIVE_INFINITY }],
  ])("rejects a final assessment input containing %s", (_reason, input) => {
    expect(() => assessmentInputSchema.parse(input)).toThrow(ZodError);
  });
});
