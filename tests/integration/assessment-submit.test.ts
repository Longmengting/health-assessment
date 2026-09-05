import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

import { calculateAssessment } from "../../src/features/assessment/calculator";
import type { AssessmentInput } from "../../src/features/assessment/types";
import { resetTestDatabase } from "../helpers/database";

const configuredTestDatabaseUrl = process.env.TEST_DATABASE_URL;
const hasProtectedTestDatabase = (() => {
  if (!configuredTestDatabaseUrl) return false;

  try {
    const databasePath = decodeURIComponent(
      new URL(configuredTestDatabaseUrl).pathname,
    ).toLowerCase();

    return ["_test", "-test", "/test", "test_"].some((marker) =>
      databasePath.includes(marker),
    );
  } catch {
    return false;
  }
})();

const testDatabaseUrl =
  configuredTestDatabaseUrl ??
  "postgresql://invalid:invalid@localhost:5432/invalid_test";

const assessmentInput: AssessmentInput = {
  gender: "male",
  goal: "lose",
  age: 30,
  heightCm: 180,
  weightKg: 80,
  targetWeightKg: 70,
  activityLevel: "moderate",
};

describe.skipIf(!hasProtectedTestDatabase)("assessment submission persistence", () => {
  const testPrisma = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  let createSession: typeof import("../../src/features/assessment/session-service").createSession;
  let saveStep: typeof import("../../src/features/assessment/session-service").saveStep;
  let submitAssessment: typeof import("../../src/features/assessment/session-service").submitAssessment;
  let sessionCookieName: typeof import("../../src/lib/session-token").sessionCookieName;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl);

    ({ createSession, saveStep, submitAssessment } = await import(
      "../../src/features/assessment/session-service"
    ));
    ({ sessionCookieName } = await import("../../src/lib/session-token"));
    await testPrisma.$connect();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
    vi.unstubAllEnvs();
  });

  async function sessionFixture() {
    const { session, token } = await createSession();
    const request = new Request(
      `http://localhost/api/sessions/${session.id}/submit`,
      {
        method: "POST",
        headers: {
          cookie: `${sessionCookieName(session.id)}=${token}`,
        },
      },
    );

    return { request, session };
  }

  async function saveCompleteAssessment(
    request: Request,
    sessionId: string,
    input: AssessmentInput = assessmentInput,
  ) {
    await saveStep({
      request,
      sessionId,
      step: "gender",
      payload: { gender: input.gender },
      expectedVersion: 0,
    });
    await saveStep({
      request,
      sessionId,
      step: "goal",
      payload: { goal: input.goal },
      expectedVersion: 1,
    });
    await saveStep({
      request,
      sessionId,
      step: "body",
      payload: {
        age: input.age,
        heightCm: input.heightCm,
        weightKg: input.weightKg,
        targetWeightKg: input.targetWeightKg,
      },
      expectedVersion: 2,
    });
    await saveStep({
      request,
      sessionId,
      step: "activity",
      payload: { activityLevel: input.activityLevel },
      expectedVersion: 3,
    });
  }

  it("authenticates before submitting a session", async () => {
    const { session } = await createSession();
    const request = new Request(
      `http://localhost/api/sessions/${session.id}/submit`,
      { method: "POST" },
    );

    await expect(
      submitAssessment({ request, sessionId: session.id }),
    ).rejects.toMatchObject({ code: "UNAUTHORIZED", status: 401 });
    await expect(
      testPrisma.assessmentResult.count({ where: { sessionId: session.id } }),
    ).resolves.toBe(0);
  });

  it("rejects an incomplete assessment and identifies every missing step", async () => {
    const { request, session } = await sessionFixture();
    await saveStep({
      request,
      sessionId: session.id,
      step: "gender",
      payload: { gender: "male" },
      expectedVersion: 0,
    });

    await expect(
      submitAssessment({
        request,
        sessionId: session.id,
        today: new Date("2026-01-01T15:30:00.000Z"),
      }),
    ).rejects.toMatchObject({
      code: "ASSESSMENT_INCOMPLETE",
      status: 422,
      fields: { steps: ["goal", "body", "activity"] },
    });

    const persisted = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { result: true },
    });
    expect(persisted).toMatchObject({
      status: "DRAFT",
      version: 1,
      completedAt: null,
      result: null,
    });
  });

  it("persists the validated formula output and completes the session atomically", async () => {
    const today = new Date("2026-01-01T15:30:00.000Z");
    const expected = calculateAssessment(assessmentInput, today);
    const { request, session } = await sessionFixture();
    await saveCompleteAssessment(request, session.id);

    const result = await submitAssessment({
      request,
      sessionId: session.id,
      today,
    });
    const persisted = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { result: true },
    });

    expect(result).toEqual({
      id: persisted.result?.id,
      sessionId: session.id,
      algorithmVersion: "1.0.0",
      bmi: expected.bmi,
      bmiCategory: expected.bmiCategory,
      createdAt: persisted.result?.createdAt.toISOString(),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /tokenHash|subscription|dailyCalories|estimatedTargetDate|protectedData|basalMetabolicRate|totalDailyEnergyExpenditure/,
    );
    expect(persisted).toMatchObject({
      status: "COMPLETED",
      version: 5,
      completedAt: expect.any(Date),
    });
    expect(persisted.result).not.toBeNull();
    expect(persisted.result?.algorithmVersion).toBe("1.0.0");
    expect(Number(persisted.result?.bmi)).toBe(expected.bmi);
    expect(persisted.result?.bmiCategory).toBe(expected.bmiCategory);
    expect(Number(persisted.result?.dailyCalories)).toBe(
      expected.recommendedDailyCalories,
    );
    expect(persisted.result?.estimatedTargetDate?.toISOString()).toBe(
      "2026-06-25T00:00:00.000Z",
    );
    expect(persisted.result?.protectedData).toEqual({
      basalMetabolicRate: expected.basalMetabolicRate,
      totalDailyEnergyExpenditure: expected.totalDailyEnergyExpenditure,
      weeklyWeightChangeKg: expected.weeklyWeightChangeKg,
      disclaimer: expected.disclaimer,
      predictionCurve: expected.predictionCurve,
    });
  });

  it("preserves a null estimated target date for a maintenance goal", async () => {
    const maintainingInput: AssessmentInput = {
      gender: "female",
      goal: "maintain",
      age: 35,
      heightCm: 165,
      weightKg: 60,
      targetWeightKg: 60,
      activityLevel: "light",
    };
    const { request, session } = await sessionFixture();
    await saveCompleteAssessment(request, session.id, maintainingInput);

    const result = await submitAssessment({
      request,
      sessionId: session.id,
      today: new Date("2026-01-01T15:30:00.000Z"),
    });
    const persisted = await testPrisma.assessmentResult.findUniqueOrThrow({
      where: { sessionId: session.id },
    });

    expect(JSON.stringify(result)).not.toContain("estimatedTargetDate");
    expect(persisted.estimatedTargetDate).toBeNull();
  });

  it("rolls back when stored JSON cannot form a valid assessment input", async () => {
    const { request, session } = await sessionFixture();
    await testPrisma.assessmentAnswer.createMany({
      data: [
        { sessionId: session.id, step: "gender", payload: { gender: "male" } },
        { sessionId: session.id, step: "goal", payload: { goal: "lose" } },
        {
          sessionId: session.id,
          step: "body",
          payload: {
            age: "30",
            heightCm: 180,
            weightKg: 80,
            targetWeightKg: 70,
          },
        },
        {
          sessionId: session.id,
          step: "activity",
          payload: { activityLevel: "moderate" },
        },
      ],
    });

    await expect(
      submitAssessment({
        request,
        sessionId: session.id,
        today: new Date("2026-01-01T15:30:00.000Z"),
      }),
    ).rejects.toBeInstanceOf(ZodError);

    const persisted = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { result: true },
    });
    expect(persisted).toMatchObject({
      status: "DRAFT",
      version: 0,
      completedAt: null,
      result: null,
    });
  });

  it("returns the original immutable result on duplicate submit", async () => {
    const firstToday = new Date("2026-01-01T15:30:00.000Z");
    const laterToday = new Date("2026-09-01T15:30:00.000Z");
    const { request, session } = await sessionFixture();
    await saveCompleteAssessment(request, session.id);

    const first = await submitAssessment({
      request,
      sessionId: session.id,
      today: firstToday,
    });
    const afterFirst = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { result: true },
    });
    const duplicate = await submitAssessment({
      request,
      sessionId: session.id,
      today: laterToday,
    });
    const afterDuplicate = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { result: true },
    });

    expect(duplicate).toEqual(first);
    expect(afterDuplicate.completedAt).toEqual(afterFirst.completedAt);
    expect(afterDuplicate.version).toBe(5);
    expect(afterDuplicate.result?.id).toBe(afterFirst.result?.id);
    expect(afterDuplicate.result?.createdAt).toEqual(afterFirst.result?.createdAt);
    expect(afterDuplicate.result?.estimatedTargetDate).toEqual(
      afterFirst.result?.estimatedTargetDate,
    );
    expect(afterDuplicate.result?.protectedData).toEqual(
      afterFirst.result?.protectedData,
    );
    await expect(
      testPrisma.assessmentResult.count({ where: { sessionId: session.id } }),
    ).resolves.toBe(1);
  });

  it("rejects step changes after submission without changing persisted state", async () => {
    const { request, session } = await sessionFixture();
    await saveCompleteAssessment(request, session.id);
    await submitAssessment({
      request,
      sessionId: session.id,
      today: new Date("2026-01-01T15:30:00.000Z"),
    });
    const before = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { answers: true, result: true },
    });

    await expect(
      saveStep({
        request,
        sessionId: session.id,
        step: "gender",
        payload: { gender: "female" },
        expectedVersion: 5,
      }),
    ).rejects.toMatchObject({ code: "SESSION_COMPLETED", status: 409 });

    const after = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { answers: true, result: true },
    });
    expect(after.version).toBe(before.version);
    expect(after.completedAt).toEqual(before.completedAt);
    expect(after.answers).toEqual(before.answers);
    expect(after.result).toEqual(before.result);
  });
});
