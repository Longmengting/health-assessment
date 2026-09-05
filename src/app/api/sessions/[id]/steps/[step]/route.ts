import { z } from "zod";

import { saveStep } from "../../../../../../features/assessment/session-service";
import { STEP_ORDER } from "../../../../../../features/assessment/progress";
import { fail, ok } from "../../../../../../lib/api-response";

const stepNameSchema = z.enum(STEP_ORDER);
const saveStepRequestSchema = z
  .object({
    data: z.unknown(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((value, context) => {
    if (!Object.prototype.hasOwnProperty.call(value, "data")) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["data"],
        message: "Required",
      });
    }
  });

interface StepRouteContext {
  params: Promise<{ id: string; step: string }>;
}

export async function PUT(request: Request, context: StepRouteContext) {
  try {
    const { id, step: routeStep } = await context.params;
    const step = stepNameSchema.parse(routeStep);
    const body = saveStepRequestSchema.parse(await request.json());
    const progress = await saveStep({
      request,
      sessionId: id,
      step,
      payload: body.data,
      expectedVersion: body.expectedVersion,
    });

    return ok(progress);
  } catch (error) {
    return fail(error);
  }
}
