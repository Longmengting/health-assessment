import { getSessionProgress } from "../../../../features/assessment/session-service";
import { fail, ok } from "../../../../lib/api-response";

interface SessionRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: SessionRouteContext) {
  try {
    const { id } = await context.params;
    const progress = await getSessionProgress(request, id);

    return ok(progress);
  } catch (error) {
    return fail(error);
  }
}
