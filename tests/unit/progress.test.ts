import { describe, expect, it } from "vitest";

import { PUT } from "../../src/app/api/sessions/[id]/steps/[step]/route";
import {
  toSessionProgressDto,
} from "../../src/features/assessment/session-service";
import { deriveProgress } from "../../src/features/assessment/progress";

describe("deriveProgress", () => {
  it("starts at gender with zero progress when no steps are complete", () => {
    expect(deriveProgress([])).toEqual({
      currentStep: "gender",
      completedSteps: [],
      progressPercent: 0,
      readyToSubmit: false,
    });
  });

  it("advances after the highest contiguous completed prefix", () => {
    expect(deriveProgress(["gender", "goal"])).toEqual({
      currentStep: "body",
      completedSteps: ["gender", "goal"],
      progressPercent: 50,
      readyToSubmit: false,
    });
  });

  it("stops at the first gap even when later steps have answers", () => {
    expect(deriveProgress(["gender", "body", "activity"])).toEqual({
      currentStep: "goal",
      completedSteps: ["gender"],
      progressPercent: 25,
      readyToSubmit: false,
    });
  });

  it("ignores unknown step names", () => {
    expect(deriveProgress(["unknown", "gender", "not-a-step"])).toEqual({
      currentStep: "goal",
      completedSteps: ["gender"],
      progressPercent: 25,
      readyToSubmit: false,
    });
  });

  it("does not count duplicate steps more than once", () => {
    expect(deriveProgress(["gender", "gender", "goal", "goal"])).toEqual({
      currentStep: "body",
      completedSteps: ["gender", "goal"],
      progressPercent: 50,
      readyToSubmit: false,
    });
  });

  it("marks the assessment ready only when every step is complete", () => {
    expect(deriveProgress(["activity", "body", "goal", "gender"])).toEqual({
      currentStep: null,
      completedSteps: ["gender", "goal", "body", "activity"],
      progressPercent: 100,
      readyToSubmit: true,
    });
  });
});

function putRequest(body: unknown) {
  return new Request("http://localhost/api/sessions/session-1/steps/gender", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("step route contract", () => {
  it("rejects an unknown route step before accessing the database", async () => {
    const response = await PUT(putRequest({ data: {}, expectedVersion: 0 }), {
      params: Promise.resolve({ id: "session-1", step: "unknown" }),
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it("rejects unknown wrapper fields before accessing the database", async () => {
    const response = await PUT(
      putRequest({ data: { gender: "female" }, expectedVersion: 0, extra: true }),
      { params: Promise.resolve({ id: "session-1", step: "gender" }) },
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
  });

  it.each([-1, 1.5])(
    "rejects an invalid expected version (%s) before accessing the database",
    async (expectedVersion) => {
      const response = await PUT(
        putRequest({ data: { gender: "female" }, expectedVersion }),
        { params: Promise.resolve({ id: "session-1", step: "gender" }) },
      );

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "VALIDATION_ERROR" },
      });
    },
  );
});

describe("session progress DTO", () => {
  it("allowlists recovery fields and never exposes protected session relations", () => {
    const persistedSession = {
      id: "session-1",
      status: "DRAFT" as const,
      version: 3,
      tokenHash: "secret-token-hash",
      currentStep: 99,
      subscription: { status: "ACTIVE" },
      result: { protectedData: { calorieSchedule: [1, 2, 3] } },
      answers: [
        {
          id: "answer-gender",
          sessionId: "session-1",
          step: "gender",
          payload: { gender: "female" },
          revision: 1,
        },
        {
          id: "answer-body",
          sessionId: "session-1",
          step: "body",
          payload: {
            age: 30,
            heightCm: 170,
            weightKg: 70,
            targetWeightKg: 65,
          },
          revision: 2,
        },
      ],
    };

    const dto = toSessionProgressDto(persistedSession);

    expect(dto).toEqual({
      id: "session-1",
      status: "DRAFT",
      version: 3,
      currentStep: "goal",
      completedSteps: ["gender"],
      progressPercent: 25,
      readyToSubmit: false,
      answers: {
        gender: { payload: { gender: "female" }, revision: 1 },
        body: {
          payload: {
            age: 30,
            heightCm: 170,
            weightKg: 70,
            targetWeightKg: 65,
          },
          revision: 2,
        },
      },
    });
    expect(JSON.stringify(dto)).not.toMatch(
      /tokenHash|subscription|protectedData|sessionId|answer-gender/,
    );
  });
});
