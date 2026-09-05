import type { AssessmentSession } from "@prisma/client";

import { AppError } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import {
  generateSessionToken,
  hashSessionToken,
  sessionCookieName,
  tokenHashesMatch,
} from "../../lib/session-token";

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

export async function createSession(): Promise<{ session: AssessmentSession; token: string }> {
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
