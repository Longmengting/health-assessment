import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { resetTestDatabase } from "../helpers/database";

const schemaPath = resolve(process.cwd(), "prisma/schema.prisma");
const schema = existsSync(schemaPath) ? readFileSync(schemaPath, "utf8") : "";

function model(name: string) {
  const match = schema.match(new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`));

  return match?.[1] ?? "";
}

describe("assessment persistence schema", () => {
  it("uses PostgreSQL and declares the required status defaults", () => {
    expect(schema).toContain('provider = "postgresql"');
    expect(schema).toContain("enum AssessmentSessionStatus");
    expect(schema).toContain("DRAFT");
    expect(schema).toContain("COMPLETED");
    expect(schema).toContain("enum SubscriptionStatus");
    expect(schema).toContain("INACTIVE");
    expect(schema).toContain("ACTIVE");
    expect(schema).toContain("EXPIRED");
    expect(schema).toContain("enum PaymentEventStatus");
  });

  it("stores a versioned assessment session with an opaque unique token", () => {
    const session = model("AssessmentSession");

    expect(session).toMatch(/id\s+String\s+@id @default\(uuid\(\)\)/);
    expect(session).toMatch(/tokenHash\s+String\s+@unique/);
    expect(session).toMatch(/status\s+AssessmentSessionStatus\s+@default\(DRAFT\)/);
    expect(session).toMatch(/currentStep\s+Int\?/);
    expect(session).toMatch(/version\s+Int\s+@default\(0\)/);
    expect(session).toMatch(/completedAt\s+DateTime\?/);
    expect(session).toMatch(/createdAt\s+DateTime\s+@default\(now\(\)\)/);
    expect(session).toMatch(/updatedAt\s+DateTime\s+@updatedAt/);
  });

  it("enforces one answer for each step in a session", () => {
    const answer = model("AssessmentAnswer");

    expect(answer).toMatch(/id\s+String\s+@id @default\(uuid\(\)\)/);
    expect(answer).toMatch(/step\s+String/);
    expect(answer).toMatch(/payload\s+Json/);
    expect(answer).toMatch(/revision\s+Int\s+@default\(1\)/);
    expect(answer).toContain("onDelete: Cascade");
    expect(answer).toContain("@@unique([sessionId, step])");
    expect(answer).toContain("@@index([sessionId])");
  });

  it("allows exactly one computed result per session", () => {
    const result = model("AssessmentResult");

    expect(result).toMatch(/sessionId\s+String\s+@unique/);
    expect(result).toMatch(/bmi\s+Decimal/);
    expect(result).toMatch(/dailyCalories\s+Decimal/);
    expect(result).toMatch(/estimatedTargetDate\s+DateTime\?/);
    expect(result).toMatch(/protectedData\s+Json/);
    expect(result).toContain("onDelete: Cascade");
  });

  it("records subscription lifecycle data per session", () => {
    const subscription = model("Subscription");

    expect(subscription).toMatch(/sessionId\s+String\s+@unique/);
    expect(subscription).toMatch(/status\s+SubscriptionStatus\s+@default\(INACTIVE\)/);
    expect(subscription).toMatch(/provider\s+String\s+@default\("MOCK"\)/);
    expect(subscription).toContain("onDelete: Cascade");
  });

  it("rejects duplicate provider event IDs while retaining their payload", () => {
    const paymentEvent = model("PaymentEvent");

    expect(paymentEvent).toMatch(/eventId\s+String\s+@unique/);
    expect(paymentEvent).toMatch(/status\s+PaymentEventStatus/);
    expect(paymentEvent).toMatch(/payload\s+Json/);
    expect(paymentEvent).toContain("onDelete: Cascade");
    expect(paymentEvent).toContain("@@index([sessionId])");
  });
});

const configuredTestUrl = process.env.TEST_DATABASE_URL;
const hasLiveTestDatabase = (() => {
  if (!configuredTestUrl) return false;

  try {
    const parsedUrl = new URL(configuredTestUrl);
    const databasePath = decodeURIComponent(parsedUrl.pathname).toLowerCase();

    return ["_test", "-test", "/test", "test_"].some((marker) =>
      databasePath.includes(marker),
    );
  } catch {
    return false;
  }
})();
const liveTestDatabaseUrl =
  configuredTestUrl ?? "postgresql://invalid:invalid@localhost:5432/invalid_test";

describe.skipIf(!hasLiveTestDatabase)("assessment persistence database constraints", () => {
  const testPrisma = new PrismaClient({
    datasources: { db: { url: liveTestDatabaseUrl } },
  });

  beforeAll(async () => {
    await testPrisma.$connect();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
  });

  it("applies session, answer, and subscription defaults", async () => {
    const session = await testPrisma.assessmentSession.create({
      data: { tokenHash: randomUUID() },
    });
    const answer = await testPrisma.assessmentAnswer.create({
      data: {
        sessionId: session.id,
        step: "goals",
        payload: { goal: "maintain" },
      },
    });
    const subscription = await testPrisma.subscription.create({
      data: { sessionId: session.id },
    });

    expect(session).toMatchObject({ status: "DRAFT", version: 0, completedAt: null });
    expect(answer.revision).toBe(1);
    expect(subscription).toMatchObject({ status: "INACTIVE", provider: "MOCK" });
  });

  it("rejects duplicate answer steps within one session", async () => {
    const session = await testPrisma.assessmentSession.create({
      data: { tokenHash: randomUUID() },
    });
    const answer = {
      sessionId: session.id,
      step: "profile",
      payload: { age: 30 },
    };

    await testPrisma.assessmentAnswer.create({ data: answer });

    await expect(testPrisma.assessmentAnswer.create({ data: answer })).rejects.toMatchObject({
      code: "P2002",
    });
  });

  it("rejects duplicate payment event IDs", async () => {
    const firstSession = await testPrisma.assessmentSession.create({
      data: { tokenHash: randomUUID() },
    });
    const secondSession = await testPrisma.assessmentSession.create({
      data: { tokenHash: randomUUID() },
    });
    const eventId = `evt_${randomUUID()}`;

    await testPrisma.paymentEvent.create({
      data: {
        eventId,
        sessionId: firstSession.id,
        status: "SUCCEEDED",
        payload: { source: "test" },
      },
    });

    await expect(
      testPrisma.paymentEvent.create({
        data: {
          eventId,
          sessionId: secondSession.id,
          status: "SUCCEEDED",
          payload: { source: "replay" },
        },
      }),
    ).rejects.toMatchObject({ code: "P2002" });
  });
});
