import { fail, ok } from "../../../lib/api-response";
import { sessionCookieName } from "../../../lib/session-token";
import { createSession } from "../../../features/assessment/session-service";

const SESSION_COOKIE_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;

export async function POST() {
  try {
    const { session, token } = await createSession();
    const response = ok(
      {
        id: session.id,
        status: session.status,
        currentStep: session.currentStep,
        version: session.version,
      },
      { status: 201 },
    );

    response.cookies.set({
      name: sessionCookieName(session.id),
      value: token,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
      path: "/",
    });

    return response;
  } catch (error) {
    return fail(error);
  }
}
