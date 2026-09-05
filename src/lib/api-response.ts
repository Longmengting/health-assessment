import { NextResponse } from "next/server";
import { ZodError } from "zod";

export type ErrorFields = Record<string, string[]>;

export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly fields?: ErrorFields;

  constructor(code: string, message: string, status: number, fields?: ErrorFields) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.fields = fields;
  }
}

type SuccessOptions = {
  requestId?: string;
  status?: number;
};

function requestId() {
  return crypto.randomUUID();
}

export function ok<T>(data: T, options: SuccessOptions = {}) {
  const responseRequestId = options.requestId ?? requestId();

  return NextResponse.json(
    { data, meta: { requestId: responseRequestId } },
    { status: options.status ?? 200 },
  );
}

export function fail(error: unknown, suppliedRequestId?: string) {
  const responseRequestId = suppliedRequestId ?? requestId();

  if (error instanceof AppError) {
    return NextResponse.json(
      {
        error: {
          code: error.code,
          message: error.message,
          ...(error.fields ? { fields: error.fields } : {}),
        },
        meta: { requestId: responseRequestId },
      },
      { status: error.status },
    );
  }

  if (error instanceof ZodError) {
    const fields = error.flatten().fieldErrors;

    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "Request validation failed.",
          ...(Object.keys(fields).length > 0 ? { fields } : {}),
        },
        meta: { requestId: responseRequestId },
      },
      { status: 400 },
    );
  }

  return NextResponse.json(
    {
      error: {
        code: "INTERNAL_ERROR",
        message: "An unexpected error occurred.",
      },
      meta: { requestId: responseRequestId },
    },
    { status: 500 },
  );
}
