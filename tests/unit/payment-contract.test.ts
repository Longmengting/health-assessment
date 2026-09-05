import { describe, expect, it } from "vitest";

import { mockPaymentCallbackSchema } from "../../src/features/payment/contracts";

describe("mock payment callback contract", () => {
  it("accepts the exact paid callback shape", () => {
    expect(
      mockPaymentCallbackSchema.parse({
        eventId: "evt_1234",
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "paid",
      }),
    ).toEqual({
      eventId: "evt_1234",
      sessionId: "11111111-1111-4111-8111-111111111111",
      status: "paid",
    });
  });

  it.each([
    {
      label: "an event ID shorter than eight characters",
      body: {
        eventId: "evt_123",
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "paid",
      },
    },
    {
      label: "an event ID longer than 120 characters",
      body: {
        eventId: `evt_${"a".repeat(117)}`,
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "paid",
      },
    },
    {
      label: "unsafe event ID characters",
      body: {
        eventId: "evt 1234",
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "paid",
      },
    },
    {
      label: "a non-UUID session ID",
      body: {
        eventId: "evt_1234",
        sessionId: "session-1",
        status: "paid",
      },
    },
    {
      label: "a status other than paid",
      body: {
        eventId: "evt_1234",
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "pending",
      },
    },
    {
      label: "an unknown property",
      body: {
        eventId: "evt_1234",
        sessionId: "11111111-1111-4111-8111-111111111111",
        status: "paid",
        amount: 4999,
      },
    },
  ])("rejects $label", ({ body }) => {
    expect(mockPaymentCallbackSchema.safeParse(body).success).toBe(false);
  });

  it("accepts event IDs at both documented length boundaries", () => {
    const sessionId = "11111111-1111-4111-8111-111111111111";

    expect(
      mockPaymentCallbackSchema.safeParse({
        eventId: "12345678",
        sessionId,
        status: "paid",
      }).success,
    ).toBe(true);
    expect(
      mockPaymentCallbackSchema.safeParse({
        eventId: `evt_${"a".repeat(116)}`,
        sessionId,
        status: "paid",
      }).success,
    ).toBe(true);
  });
});
