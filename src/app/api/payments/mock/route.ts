import {
  mockPaymentCallbackSchema,
  requireMockPaymentAuthorization,
} from "../../../../features/payment/contracts";
import { activateMockSubscription } from "../../../../features/payment/payment-service";
import { AppError, fail, ok } from "../../../../lib/api-response";

async function callbackJson(request: Request) {
  try {
    return await request.json();
  } catch {
    throw new AppError(
      "VALIDATION_ERROR",
      "Request validation failed.",
      400,
    );
  }
}

export async function POST(request: Request) {
  try {
    requireMockPaymentAuthorization(request);
    const callback = mockPaymentCallbackSchema.parse(
      await callbackJson(request),
    );
    const outcome = await activateMockSubscription(callback);

    return ok({
      eventId: outcome.eventId,
      sessionId: outcome.sessionId,
      subscriptionStatus: outcome.subscriptionStatus,
      activatedAt: outcome.activatedAt,
      expiresAt: outcome.expiresAt,
      replayed: outcome.replayed,
    });
  } catch (error) {
    return fail(error);
  }
}
