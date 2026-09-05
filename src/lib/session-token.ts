import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_COOKIE_PREFIX = "health_path_session";

export function generateSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function hashSessionToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function sessionCookieName(sessionId: string): string {
  const safeSessionId = hashSessionToken(sessionId).slice(0, 32);

  return `${SESSION_COOKIE_PREFIX}_${safeSessionId}`;
}

export function tokenHashesMatch(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "hex");
  const rightBuffer = Buffer.from(right, "hex");

  return (
    leftBuffer.length === rightBuffer.length &&
    timingSafeEqual(leftBuffer, rightBuffer)
  );
}
