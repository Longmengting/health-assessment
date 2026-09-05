import { createHash, timingSafeEqual } from "node:crypto";

import { z } from "zod";

import { AppError } from "../../lib/api-response";

const SAFE_EVENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MINIMUM_SECRET_LENGTH = 24;

export const mockPaymentCallbackSchema = z
  .object({
    eventId: z.string().min(8).max(120).regex(SAFE_EVENT_ID),
    sessionId: z.string().uuid(),
    status: z.literal("paid"),
  })
  .strict();

export type MockPaymentCallback = z.infer<typeof mockPaymentCallbackSchema>;

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest();
}

function paymentNotConfigured() {
  return new AppError(
    "PAYMENT_NOT_CONFIGURED",
    "Mock payment callbacks are not configured.",
    503,
  );
}

function invalidPaymentSecret() {
  return new AppError(
    "INVALID_PAYMENT_SECRET",
    "The mock payment secret is invalid.",
    401,
  );
}

export function requireMockPaymentAuthorization(request: Request) {
  const configuredSecret = process.env.MOCK_PAYMENT_SECRET;
  if (
    configuredSecret === undefined ||
    configuredSecret.length < MINIMUM_SECRET_LENGTH
  ) {
    throw paymentNotConfigured();
  }

  const authorization = request.headers.get("authorization") ?? "";
  const match = /^Bearer ([^\s]+)$/i.exec(authorization);
  const suppliedSecret = match?.[1] ?? "";

  // SHA-256 makes both inputs a fixed length before the timing-safe comparison.
  const secretMatches = timingSafeEqual(
    digest(suppliedSecret),
    digest(configuredSecret),
  );
  if (!match || !secretMatches) throw invalidPaymentSecret();
}
