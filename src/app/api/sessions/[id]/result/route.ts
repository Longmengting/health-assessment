import { getAuthorizedResult } from "../../../../../features/assessment/result-policy";
import { fail, ok } from "../../../../../lib/api-response";

interface ResultRouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(request: Request, context: ResultRouteContext) {
  try {
    const { id } = await context.params;
    const result = await getAuthorizedResult(request, id);

    return ok(result);
  } catch (error) {
    return fail(error);
  }
}
