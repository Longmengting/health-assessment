import { submitAssessment } from "../../../../../features/assessment/session-service";
import { AppError, fail, ok } from "../../../../../lib/api-response";

interface SubmitRouteContext {
  params: Promise<{ id: string }>;
}

function nonEmptyBody(): AppError {
  return new AppError(
    "VALIDATION_ERROR",
    "Request validation failed.",
    400,
    { body: ["Submit requests must not include a body."] },
  );
}

export async function POST(request: Request, context: SubmitRouteContext) {
  try {
    if ((await request.text()).length > 0) throw nonEmptyBody();

    const { id } = await context.params;
    const result = await submitAssessment({ request, sessionId: id });

    return ok({
      id: result.id,
      sessionId: result.sessionId,
      algorithmVersion: result.algorithmVersion,
      bmi: result.bmi,
      bmiCategory: result.bmiCategory,
      createdAt: result.createdAt,
    });
  } catch (error) {
    return fail(error);
  }
}
