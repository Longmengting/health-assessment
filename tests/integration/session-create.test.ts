import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
  configuredTestDatabaseUrl ?? "postgresql://invalid:invalid@localhost:5432/invalid_test";

describe.skipIf(!hasProtectedTestDatabase)("session creation and recovery", () => {
  const testPrisma = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  let createSession: typeof import("../../src/features/assessment/session-service").createSession;
  let requireSessionAccess: typeof import("../../src/features/assessment/session-service").requireSessionAccess;
  let hashSessionToken: typeof import("../../src/lib/session-token").hashSessionToken;
  let sessionCookieName: typeof import("../../src/lib/session-token").sessionCookieName;
  let POST: typeof import("../../src/app/api/sessions/route").POST;

  beforeAll(async () => {
    vi.stubEnv("DATABASE_URL", testDatabaseUrl);
    vi.stubEnv("NODE_ENV", "production");

    ({ createSession, requireSessionAccess } = await import(
      "../../src/features/assessment/session-service"
    ));
    ({ hashSessionToken, sessionCookieName } = await import("../../src/lib/session-token"));
    ({ POST } = await import("../../src/app/api/sessions/route"));
    await testPrisma.$connect();
  });

  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterAll(async () => {
    await testPrisma.$disconnect();
    vi.unstubAllEnvs();
  });

  it("persists only the token hash and creates an inactive subscription", async () => {
    const { session, token } = await createSession();
    const persisted = await testPrisma.assessmentSession.findUnique({
      where: { id: session.id },
      include: { subscription: true },
    });

    expect(persisted).toMatchObject({
      id: session.id,
      tokenHash: hashSessionToken(token),
      status: "DRAFT",
      currentStep: null,
      version: 0,
      subscription: { status: "INACTIVE" },
    });
    expect(JSON.stringify(persisted)).not.toContain(token);
  });

  it("grants access only when the session-specific cookie has the matching token", async () => {
    const { session, token } = await createSession();
    const validRequest = new Request("http://localhost/api/sessions/current", {
      headers: { cookie: `${sessionCookieName(session.id)}=${token}` },
    });
    const invalidRequest = new Request("http://localhost/api/sessions/current", {
      headers: { cookie: `${sessionCookieName(session.id)}=wrong-token` },
    });

    await expect(requireSessionAccess(validRequest, session.id)).resolves.toMatchObject({
      id: session.id,
    });
    await expect(requireSessionAccess(invalidRequest, session.id)).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      status: 401,
    });
  });

  it("returns a public session envelope and sets a hardened session cookie", async () => {
    const response = await POST(new Request("http://localhost/api/sessions", { method: "POST" }));
    const payload = await response.json();
    const setCookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({
      data: {
        id: expect.any(String),
        status: "DRAFT",
        currentStep: null,
        version: 0,
      },
      meta: { requestId: expect.any(String) },
    });
    expect(JSON.stringify(payload)).not.toMatch(/token|hash/i);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toMatch(/SameSite=Lax/i);
    expect(setCookie).toContain("Secure");
    expect(setCookie).toContain("Max-Age=2592000");
  });
});
