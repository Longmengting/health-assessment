import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const activateMockSubscriptionMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/features/payment/payment-service", () => ({
  activateMockSubscription: activateMockSubscriptionMock,
}));

import { POST } from "../../src/app/api/payments/mock/route";
import { POST as compatibilityPOST } from "../../src/app/pay/route";

const configuredSecret = "task8-demo-payment-secret-123456";
const callbackBody = {
  eventId: "evt_1234",
  sessionId: "11111111-1111-4111-8111-111111111111",
  status: "paid",
} as const;

function paymentRequest(
  body: unknown = callbackBody,
  authorization: string | null = `Bearer ${configuredSecret}`,
) {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization !== null) {
    headers.set("authorization", authorization);
  }

  return new Request("http://localhost/api/payments/mock", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

describe("mock payment route", () => {
  beforeEach(() => {
    activateMockSubscriptionMock.mockReset();
    vi.stubEnv("MOCK_PAYMENT_SECRET", configuredSecret);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it.each([undefined, "too-short"])(
    "returns PAYMENT_NOT_CONFIGURED for an absent or unsafe server secret",
    async (secret) => {
      if (secret === undefined) {
        vi.stubEnv("MOCK_PAYMENT_SECRET", "");
      } else {
        vi.stubEnv("MOCK_PAYMENT_SECRET", secret);
      }

      const response = await POST(paymentRequest());

      expect(response.status).toBe(503);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "PAYMENT_NOT_CONFIGURED",
          message: "Mock payment callbacks are not configured.",
        },
        meta: { requestId: expect.any(String) },
      });
      expect(activateMockSubscriptionMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { label: "a missing header", authorization: null },
    { label: "a wrong secret", authorization: "Bearer definitely-wrong-secret-value" },
    { label: "a malformed scheme", authorization: configuredSecret },
    { label: "a Bearer token with whitespace", authorization: `Bearer ${configuredSecret} extra` },
  ])("returns INVALID_PAYMENT_SECRET for $label", async ({ authorization }) => {
    const response = await POST(paymentRequest(callbackBody, authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_PAYMENT_SECRET" },
    });
    expect(activateMockSubscriptionMock).not.toHaveBeenCalled();
  });

  it("rejects unknown callback properties before activating a subscription", async () => {
    const response = await POST(
      paymentRequest({ ...callbackBody, internalOverride: true }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "VALIDATION_ERROR" },
    });
    expect(activateMockSubscriptionMock).not.toHaveBeenCalled();
  });

  it("returns only allowlisted payment outcome fields", async () => {
    activateMockSubscriptionMock.mockResolvedValue({
      eventId: callbackBody.eventId,
      sessionId: callbackBody.sessionId,
      subscriptionStatus: "ACTIVE",
      activatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-31T00:00:00.000Z",
      replayed: false,
      provider: "MOCK",
      externalPaymentId: callbackBody.eventId,
      tokenHash: "must-not-leak",
      protectedData: { dailyCalories: 2319 },
    });
    const request = paymentRequest();

    const response = await POST(request);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        eventId: callbackBody.eventId,
        sessionId: callbackBody.sessionId,
        subscriptionStatus: "ACTIVE",
        activatedAt: "2026-01-01T00:00:00.000Z",
        expiresAt: "2026-01-31T00:00:00.000Z",
        replayed: false,
      },
      meta: { requestId: expect.any(String) },
    });
    expect(activateMockSubscriptionMock).toHaveBeenCalledWith(callbackBody);
  });

  it("exposes the same authenticated handler at the assignment-compatible /pay route", async () => {
    activateMockSubscriptionMock.mockResolvedValue({
      eventId: callbackBody.eventId,
      sessionId: callbackBody.sessionId,
      subscriptionStatus: "ACTIVE",
      activatedAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-31T00:00:00.000Z",
      replayed: true,
    });

    expect(compatibilityPOST).toBe(POST);
    const response = await compatibilityPOST(paymentRequest());
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: { eventId: callbackBody.eventId, replayed: true },
    });
  });
});
