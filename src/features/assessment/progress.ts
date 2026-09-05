import type { StepName } from "./types";

export const STEP_ORDER = [
  "gender",
  "goal",
  "body",
  "activity",
] as const satisfies readonly StepName[];

export interface AssessmentProgress {
  currentStep: StepName | null;
  completedSteps: StepName[];
  progressPercent: number;
  readyToSubmit: boolean;
}

export function deriveProgress(
  completedSteps: Iterable<string>,
): AssessmentProgress {
  const completed = new Set(completedSteps);
  const contiguousSteps: StepName[] = [];

  for (const step of STEP_ORDER) {
    if (!completed.has(step)) break;
    contiguousSteps.push(step);
  }

  const currentStep = STEP_ORDER[contiguousSteps.length] ?? null;

  return {
    currentStep,
    completedSteps: contiguousSteps,
    progressPercent: (contiguousSteps.length / STEP_ORDER.length) * 100,
    readyToSubmit: contiguousSteps.length === STEP_ORDER.length,
  };
}
