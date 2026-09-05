import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";

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

describe.skipIf(!hasProtectedTestDatabase)("session progress persistence", () => {
  const testPrisma = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  let createSession: typeof import("../../src/features/assessment/session-service").createSession;
  let getSessionProgress: typeof import("../../src/features/assessment/session-service").getSessionProgress;
  let saveStep: typeof import("../../src/features/assessment/session-service").saveStep;
  let sessionCookieName: typeof import("../../src/lib/session-token").sessionCookieName;
  let GET: typeof import("../../src/app/api/sessions/[id]/route").GET;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl);

    ({ createSession, getSessionProgress, saveStep } = await import(
      "../../src/features/assessment/session-service"
    ));
    ({ sessionCookieName } = await import("../../src/lib/session-token"));
    ({ GET } = await import("../../src/app/api/sessions/[id]/route"));
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
    const request = new Request(`http://localhost/api/sessions/${session.id}`, {
      headers: {
        cookie: `${sessionCookieName(session.id)}=${token}`,
      },
    });

    return { request, session };
  }

  it("restores interrupted progress and saved answers through GET", async () => {
    const { request, session } = await sessionFixture();
    await saveStep({
      request,
      sessionId: session.id,
      step: "gender",
      payload: { gender: "female" },
      expectedVersion: 0,
    });
    await saveStep({
      request,
      sessionId: session.id,
      step: "goal",
      payload: { goal: "lose" },
      expectedVersion: 1,
    });

    const response = await GET(request, {
      params: Promise.resolve({ id: session.id }),
    });
    const envelope = await response.json();

    expect(response.status).toBe(200);
    expect(envelope.data).toEqual({
      id: session.id,
      status: "DRAFT",
      version: 2,
      currentStep: "body",
      completedSteps: ["gender", "goal"],
      progressPercent: 50,
      readyToSubmit: false,
      answers: {
        gender: { payload: { gender: "female" }, revision: 1 },
        goal: { payload: { goal: "lose" }, revision: 1 },
      },
    });
    expect(JSON.stringify(envelope.data)).not.toMatch(
      /tokenHash|subscription|protectedData/,
    );
  });

  it("treats an identical current-version replay as a true no-op", async () => {
    const { request, session } = await sessionFixture();
    const first = await saveStep({
      request,
      sessionId: session.id,
      step: "gender",
      payload: { gender: "female" },
      expectedVersion: 0,
    });
    const before = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { answers: true },
    });

    const replay = await saveStep({
      request,
      sessionId: session.id,
      step: "gender",
      payload: { gender: "female" },
      expectedVersion: first.version,
    });
    const after = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { answers: true },
    });

    expect(replay.version).toBe(1);
    expect(replay.answers.gender?.revision).toBe(1);
    expect(after.version).toBe(before.version);
    expect(after.updatedAt).toEqual(before.updatedAt);
    expect(after.answers).toHaveLength(1);
    expect(after.answers[0]?.revision).toBe(1);
    expect(after.answers[0]?.updatedAt).toEqual(before.answers[0]?.updatedAt);
  });

  it("increments both answer revision and session version for a historical edit", async () => {
    const { request, session } = await sessionFixture();
    await saveStep({
      request,
      sessionId: session.id,
      step: "gender",
      payload: { gender: "female" },
      expectedVersion: 0,
    });
    await saveStep({
      request,
      sessionId: session.id,
      step: "goal",
      payload: { goal: "lose" },
      expectedVersion: 1,
    });

    const changed = await saveStep({
      request,
      sessionId: session.id,
      step: "gender",
      payload: { gender: "male" },
      expectedVersion: 2,
    });

    expect(changed).toMatchObject({
      version: 3,
      currentStep: "body",
      completedSteps: ["gender", "goal"],
      answers: {
        gender: { payload: { gender: "male" }, revision: 2 },
      },
    });
  });

  it("persists an out-of-order answer without advancing over a gap", async () => {
    const { request, session } = await sessionFixture();

    const saved = await saveStep({
      request,
      sessionId: session.id,
      step: "body",
      payload: {
        age: 30,
        heightCm: 170,
        weightKg: 70,
        targetWeightKg: 65,
      },
      expectedVersion: 0,
    });

    expect(saved).toMatchObject({
      version: 1,
      currentStep: "gender",
      completedSteps: [],
      progressPercent: 0,
      readyToSubmit: false,
      answers: {
        body: { revision: 1 },
      },
    });
  });

  it("rolls back completely when a step payload is invalid", async () => {
    const { request, session } = await sessionFixture();

    await expect(
      saveStep({
        request,
        sessionId: session.id,
        step: "body",
        payload: {
          age: 17,
          heightCm: 170,
          weightKg: 70,
          targetWeightKg: 65,
        },
        expectedVersion: 0,
      }),
    ).rejects.toBeInstanceOf(ZodError);

    const persisted = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { answers: true },
    });
    expect(persisted.version).toBe(0);
    expect(persisted.answers).toEqual([]);
  });

  it("keeps completed sessions immutable", async () => {
    const { request, session } = await sessionFixture();
    await testPrisma.assessmentSession.update({
      where: { id: session.id },
      data: { status: "COMPLETED", completedAt: new Date("2026-09-05T00:00:00Z") },
    });

    await expect(
      saveStep({
        request,
        sessionId: session.id,
        step: "gender",
        payload: { gender: "female" },
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({ code: "SESSION_COMPLETED", status: 409 });

    const persisted = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { answers: true },
    });
    expect(persisted.version).toBe(0);
    expect(persisted.answers).toEqual([]);
  });

  it("allows only one of two writes sharing an expected version to commit", async () => {
    const { request, session } = await sessionFixture();

    const results = await Promise.allSettled([
      saveStep({
        request,
        sessionId: session.id,
        step: "gender",
        payload: { gender: "female" },
        expectedVersion: 0,
      }),
      saveStep({
        request,
        sessionId: session.id,
        step: "goal",
        payload: { goal: "lose" },
        expectedVersion: 0,
      }),
    ]);
    const fulfilled = results.filter(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof saveStep>>> =>
        result.status === "fulfilled",
    );
    const rejected = results.filter(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    );

    expect(fulfilled).toHaveLength(1);
    expect(fulfilled[0]?.value.version).toBe(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      fields: { currentVersion: 1 },
    });

    const persisted = await testPrisma.assessmentSession.findUniqueOrThrow({
      where: { id: session.id },
      include: { answers: true },
    });
    expect(persisted.version).toBe(1);
    expect(persisted.answers).toHaveLength(1);
  });

  it("rejects a stale identical payload rather than treating it as a replay", async () => {
    const { request, session } = await sessionFixture();
    await saveStep({
      request,
      sessionId: session.id,
      step: "gender",
      payload: { gender: "female" },
      expectedVersion: 0,
    });

    await expect(
      saveStep({
        request,
        sessionId: session.id,
        step: "gender",
        payload: { gender: "female" },
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({
      code: "VERSION_CONFLICT",
      status: 409,
      fields: { currentVersion: 1 },
    });

    const restored = await getSessionProgress(request, session.id);
    expect(restored.version).toBe(1);
    expect(restored.answers.gender?.revision).toBe(1);
  });
});
