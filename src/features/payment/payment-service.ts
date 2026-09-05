import { Prisma, type PaymentEvent } from "@prisma/client";
import { z } from "zod";

import { AppError } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import {
  mockPaymentCallbackSchema,
  type MockPaymentCallback,
} from "./contracts";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000;
const activeSubscriptionSchema = z
  .object({
    status: z.literal("ACTIVE"),
    provider: z.literal("MOCK"),
    externalPaymentId: z.string(),
    activatedAt: z.date(),
    expiresAt: z.date(),
  })
  .strict();

export interface ActivateMockSubscriptionInput extends MockPaymentCallback {
  now?: Date;
}

export interface MockPaymentOutcome {
  eventId: string;
  sessionId: string;
  subscriptionStatus: "ACTIVE";
  activatedAt: string;
  expiresAt: string;
  replayed: boolean;
}

const paymentEventSelect = {
  eventId: true,
  sessionId: true,
  status: true,
  payload: true,
} satisfies Prisma.PaymentEventSelect;

const subscriptionOutcomeSelect = {
  status: true,
  provider: true,
  externalPaymentId: true,
  activatedAt: true,
  expiresAt: true,
} satisfies Prisma.SubscriptionSelect;

type StoredPaymentEvent = Pick<
  PaymentEvent,
  "eventId" | "sessionId" | "status" | "payload"
>;

function paymentEventConflict() {
  return new AppError(
    "PAYMENT_EVENT_CONFLICT",
    "The payment event ID was already used for another callback.",
    409,
  );
}

function sessionNotFound() {
  return new AppError(
    "SESSION_NOT_FOUND",
    "The assessment session was not found.",
    404,
  );
}

function assessmentIncomplete() {
  return new AppError(
    "ASSESSMENT_INCOMPLETE",
    "The assessment must be completed before payment.",
    422,
  );
}

function invalidStoredPayment() {
  return new AppError(
    "PAYMENT_STATE_INVALID",
    "The stored payment state is invalid.",
    500,
  );
}

function isMatchingSuccessfulEvent(
  event: StoredPaymentEvent,
  input: MockPaymentCallback,
) {
  const payload = mockPaymentCallbackSchema.safeParse(event.payload);

  return (
    event.status === "SUCCEEDED" &&
    event.eventId === input.eventId &&
    event.sessionId === input.sessionId &&
    payload.success &&
    payload.data.eventId === input.eventId &&
    payload.data.sessionId === input.sessionId &&
    payload.data.status === input.status
  );
}

function toOutcome(
  input: MockPaymentCallback,
  subscription: unknown,
  replayed: boolean,
): MockPaymentOutcome {
  const parsed = activeSubscriptionSchema.safeParse(subscription);
  if (
    !parsed.success ||
    parsed.data.externalPaymentId !== input.eventId
  ) {
    throw invalidStoredPayment();
  }

  return {
    eventId: input.eventId,
    sessionId: input.sessionId,
    subscriptionStatus: "ACTIVE",
    activatedAt: parsed.data.activatedAt.toISOString(),
    expiresAt: parsed.data.expiresAt.toISOString(),
    replayed,
  };
}

async function replayOutcome(
  transaction: Prisma.TransactionClient,
  event: StoredPaymentEvent,
  input: MockPaymentCallback,
) {
  if (!isMatchingSuccessfulEvent(event, input)) {
    throw paymentEventConflict();
  }

  const subscription = await transaction.subscription.findUnique({
    where: { sessionId: input.sessionId },
    select: subscriptionOutcomeSelect,
  });

  return toOutcome(input, subscription, true);
}

async function activateInTransaction(
  input: MockPaymentCallback,
  activationTime: Date,
) {
  return prisma.$transaction(async (transaction) => {
    const existingEvent = await transaction.paymentEvent.findUnique({
      where: { eventId: input.eventId },
      select: paymentEventSelect,
    });
    if (existingEvent) {
      return replayOutcome(transaction, existingEvent, input);
    }

    const session = await transaction.assessmentSession.findUnique({
      where: { id: input.sessionId },
      select: {
        status: true,
        result: { select: { id: true } },
      },
    });
    if (!session) throw sessionNotFound();
    if (session.status !== "COMPLETED" || session.result === null) {
      throw assessmentIncomplete();
    }

    const expiresAt = new Date(activationTime.getTime() + THIRTY_DAYS_MS);
    const payload: Prisma.InputJsonObject = {
      eventId: input.eventId,
      sessionId: input.sessionId,
      status: input.status,
    };

    await transaction.paymentEvent.create({
      data: {
        eventId: input.eventId,
        sessionId: input.sessionId,
        status: "SUCCEEDED",
        payload,
      },
    });

    const subscription = await transaction.subscription.upsert({
      where: { sessionId: input.sessionId },
      create: {
        sessionId: input.sessionId,
        status: "ACTIVE",
        provider: "MOCK",
        externalPaymentId: input.eventId,
        activatedAt: activationTime,
        expiresAt,
      },
      update: {
        status: "ACTIVE",
        provider: "MOCK",
        externalPaymentId: input.eventId,
        activatedAt: activationTime,
        expiresAt,
      },
      select: subscriptionOutcomeSelect,
    });

    return toOutcome(input, subscription, false);
  });
}

async function recoverConcurrentReplay(
  input: MockPaymentCallback,
  uniqueConstraintError: Prisma.PrismaClientKnownRequestError,
) {
  return prisma.$transaction(async (transaction) => {
    const event = await transaction.paymentEvent.findUnique({
      where: { eventId: input.eventId },
      select: paymentEventSelect,
    });
    // A different unique constraint can also surface as P2002. Preserve that
    // original database error unless another transaction actually won eventId.
    if (!event) throw uniqueConstraintError;

    return replayOutcome(transaction, event, input);
  });
}

export async function activateMockSubscription({
  eventId,
  sessionId,
  status,
  now = new Date(),
}: ActivateMockSubscriptionInput): Promise<MockPaymentOutcome> {
  const input = { eventId, sessionId, status };

  try {
    return await activateInTransaction(input, now);
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === "P2002"
    ) {
      return recoverConcurrentReplay(input, error);
    }

    throw error;
  }
}
