import { describe, expect, it } from "vitest";

import {
  generateSessionToken,
  hashSessionToken,
  sessionCookieName,
} from "../../src/lib/session-token";

describe("session tokens", () => {
  it("generates distinct base64url tokens from 32 random bytes", () => {
    const firstToken = generateSessionToken();
    const secondToken = generateSessionToken();

    expect(firstToken).not.toBe(secondToken);
    expect(firstToken).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(Buffer.from(firstToken, "base64url")).toHaveLength(32);
    expect(Buffer.from(secondToken, "base64url")).toHaveLength(32);
  });

  it("creates deterministic SHA-256 hashes that do not expose the token", () => {
    const token = "sensitive-session-token-value";
    const hash = hashSessionToken(token);

    expect(hashSessionToken(token)).toBe(hash);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(token);
    expect(hash).not.toBe(token);
  });

  it("derives a stable cookie name without using uncontrolled session characters", () => {
    const sessionId = "session; ../\\u2603 with spaces";
    const cookieName = sessionCookieName(sessionId);

    expect(sessionCookieName(sessionId)).toBe(cookieName);
    expect(cookieName).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(cookieName).not.toContain(sessionId);
  });
});
