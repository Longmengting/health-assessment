import { describe, expect, it } from "vitest";
import { z } from "zod";

import { AppError, fail, ok } from "../../src/lib/api-response";

describe("API response envelopes", () => {
  it("wraps successful data with the supplied request ID and status", async () => {
    const response = ok({ ready: true }, { requestId: "request-123", status: 201 });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({
      data: { ready: true },
      meta: { requestId: "request-123" },
    });
  });

  it("preserves typed application errors and their safe field details", async () => {
    const response = fail(
      new AppError("INVALID_INPUT", "The submitted data is invalid.", 422, {
        age: ["Must be at least 18."],
      }),
      "request-typed",
    );

    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INVALID_INPUT",
        message: "The submitted data is invalid.",
        fields: { age: ["Must be at least 18."] },
      },
      meta: { requestId: "request-typed" },
    });
  });

  it("maps Zod validation errors to a safe validation envelope", async () => {
    const schema = z.object({ email: z.string().email() });
    const error = schema.safeParse({ email: "not-an-email" }).error;

    expect(error).toBeDefined();

    const response = fail(error, "request-zod");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        fields: { email: ["Invalid email"] },
      },
      meta: { requestId: "request-zod" },
    });
  });

  it("sanitizes unexpected errors without leaking internal messages", async () => {
    const response = fail(new Error("database password: secret"), "request-unknown");

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
      meta: { requestId: "request-unknown" },
    });
  });
});
