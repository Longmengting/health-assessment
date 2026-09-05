import { isDeepStrictEqual } from "node:util";

import type { AssessmentSession, Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError, type ErrorFields } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import {
  generateSessionToken,
  hashSessionToken,
  sessionCookieName,
  tokenHashesMatch,
} from "../../lib/session-token";
import { parseStepPayload } from "./contracts";
import { deriveProgress, STEP_ORDER } from "./progress";
import type { StepName, StepPayloadByName } from "./types";

const stepNameSchema: z.ZodType<StepName> = z.enum(STEP_ORDER);

const sessionProgressSelect = {
  id: true,
  status: true,
  version: true,
  answers: {
    select: {
      step: true,
      payload: true,
      revision: true,
    },
    orderBy: { createdAt: "asc" },
  },
} satisfies Prisma.AssessmentSessionSelect;

type SessionProgressSource = {
  id: string;
  status: AssessmentSession["status"];
  version: number;
  answers: readonly {
    step: string;
    payload: Prisma.JsonValue;
    revision: number;
  }[];
};

export interface SessionAnswerDto {
  payload: StepPayloadByName[StepName];
  revision: number;
}

export interface SessionProgressDto {
  id: string;
  status: AssessmentSession["status"];
  version: number;
  currentStep: StepName | null;
  completedSteps: StepName[];
  progressPercent: number;
  readyToSubmit: boolean;
  answers: Partial<Record<StepName, SessionAnswerDto>>;
}

function cookieValue(request: Request, name: string): string | undefined {
  const cookieHeader = request.headers.get("cookie");
  if (!cookieHeader) return undefined;

  for (const entry of cookieHeader.split(";")) {
    const separatorIndex = entry.indexOf("=");
    if (separatorIndex < 0) continue;

    const cookieName = entry.slice(0, separatorIndex).trim();
    if (cookieName !== name) continue;

    try {
      return decodeURIComponent(entry.slice(separatorIndex + 1).trim());
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function unauthorized(): AppError {
  return new AppError("UNAUTHORIZED", "Session access is invalid.", 401);
}

function completedSession(): AppError {
  return new AppError(
    "SESSION_COMPLETED",
    "Completed assessment sessions cannot be changed.",
    409,
  );
}

function versionConflict(currentVersion: number): AppError {
  return new AppError(
    "VERSION_CONFLICT",
    "The assessment session was changed by another request.",
    409,
    { currentVersion } as unknown as ErrorFields,
  );
}

function currentStepIndex(currentStep: StepName | null): number | null {
  return currentStep === null ? null : STEP_ORDER.indexOf(currentStep);
}

function toInputJsonValue(
  payload: StepPayloadByName[StepName],
): Prisma.InputJsonValue {
  // Strict Zod step schemas admit only JSON-safe objects with scalar values.
  return payload as unknown as Prisma.InputJsonValue;
}

export function toSessionProgressDto(
  source: SessionProgressSource,
): SessionProgressDto {
  const answers: Partial<Record<StepName, SessionAnswerDto>> = {};

  for (const answer of source.answers) {
    const parsedStep = stepNameSchema.safeParse(answer.step);
    if (!parsedStep.success) continue;

    answers[parsedStep.data] = {
      payload: parseStepPayload(parsedStep.data, answer.payload),
      revision: answer.revision,
    };
  }

  const progress = deriveProgress(Object.keys(answers));

  return {
    id: source.id,
    status: source.status,
    version: source.version,
    ...progress,
    answers,
  };
}

export async function requireSessionAccess(
  request: Request,
  sessionId: string,
): Promise<AssessmentSession> {
  const token = cookieValue(request, sessionCookieName(sessionId));
  if (!token) throw unauthorized();

  const session = await prisma.assessmentSession.findUnique({
    where: { id: sessionId },
  });
  if (!session) throw unauthorized();

  if (!tokenHashesMatch(hashSessionToken(token), session.tokenHash)) {
    throw unauthorized();
  }

  return session;
}

export async function createSession(): Promise<{
  session: AssessmentSession;
  token: string;
}> {
  return prisma.$transaction(async (transaction) => {
    const token = generateSessionToken();
    const session = await transaction.assessmentSession.create({
      data: { tokenHash: hashSessionToken(token) },
    });

    await transaction.subscription.create({
      data: { sessionId: session.id, status: "INACTIVE" },
    });

    return { session, token };
  });
}

export async function getSessionProgress(
  request: Request,
  sessionId: string,
): Promise<SessionProgressDto> {
  await requireSessionAccess(request, sessionId);

  const session = await prisma.assessmentSession.findUnique({
    where: { id: sessionId },
    select: sessionProgressSelect,
  });
  if (!session) throw unauthorized();

  return toSessionProgressDto(session);
}

interface SaveStepInput {
  request: Request;
  sessionId: string;
  step: string;
  payload: unknown;
  expectedVersion: number;
}

export async function saveStep({
  request,
  sessionId,
  step,
  payload,
  expectedVersion,
}: SaveStepInput): Promise<SessionProgressDto> {
  const accessedSession = await requireSessionAccess(request, sessionId);
  const parsedStep = stepNameSchema.parse(step);
  const parsedPayload = parseStepPayload(parsedStep, payload);

  if (accessedSession.status === "COMPLETED") throw completedSession();

  return prisma.$transaction(async (transaction) => {
    const current = await transaction.assessmentSession.findUnique({
      where: { id: sessionId },
      select: { status: true, version: true },
    });
    if (!current) throw unauthorized();
    if (current.status === "COMPLETED") throw completedSession();
    if (current.version !== expectedVersion) {
      throw versionConflict(current.version);
    }

    const existingAnswer = await transaction.assessmentAnswer.findUnique({
      where: {
        sessionId_step: { sessionId, step: parsedStep },
      },
      select: { payload: true },
    });

    if (
      existingAnswer &&
      isDeepStrictEqual(existingAnswer.payload, parsedPayload)
    ) {
      const unchanged = await transaction.assessmentSession.findFirst({
        where: { id: sessionId, status: "DRAFT", version: expectedVersion },
        select: sessionProgressSelect,
      });

      if (unchanged) return toSessionProgressDto(unchanged);

      const latest = await transaction.assessmentSession.findUnique({
        where: { id: sessionId },
        select: { status: true, version: true },
      });
      if (!latest) throw unauthorized();
      if (latest.status === "COMPLETED") throw completedSession();
      throw versionConflict(latest.version);
    }

    const jsonPayload = toInputJsonValue(parsedPayload);

    await transaction.assessmentAnswer.upsert({
      where: {
        sessionId_step: { sessionId, step: parsedStep },
      },
      create: {
        sessionId,
        step: parsedStep,
        payload: jsonPayload,
      },
      update: {
        payload: jsonPayload,
        revision: { increment: 1 },
      },
    });

    const completedStepRows = await transaction.assessmentAnswer.findMany({
      where: { sessionId },
      select: { step: true },
    });
    const progress = deriveProgress(
      completedStepRows.map((answer) => answer.step),
    );

    const comparedUpdate = await transaction.assessmentSession.updateMany({
      where: {
        id: sessionId,
        version: expectedVersion,
        status: "DRAFT",
      },
      data: {
        currentStep: currentStepIndex(progress.currentStep),
        version: { increment: 1 },
      },
    });

    if (comparedUpdate.count !== 1) {
      const latest = await transaction.assessmentSession.findUnique({
        where: { id: sessionId },
        select: { status: true, version: true },
      });
      if (!latest) throw unauthorized();
      if (latest.status === "COMPLETED") throw completedSession();
      throw versionConflict(latest.version);
    }

    const updated = await transaction.assessmentSession.findUnique({
      where: { id: sessionId },
      select: sessionProgressSelect,
    });
    if (!updated) throw unauthorized();

    return toSessionProgressDto(updated);
  });
}
