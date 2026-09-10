import { Prisma } from "@prisma/client";
import { z } from "zod";

import { AppError } from "../../lib/api-response";
import { prisma } from "../../lib/prisma";
import { requireSessionAccess } from "./session-service";

export const PROTECTED_RESULT_KEYS = [
  "recommendedDailyCalories",
  "basalMetabolicRate",
  "totalDailyEnergyExpenditure",
  "estimatedTargetDate",
  "weeklyWeightChangeKg",
  "predictionCurve",
] as const;

const bmiCategorySchema = z.enum([
  "underweight",
  "normal",
  "overweight",
  "obese",
]);
const subscriptionStatusSchema = z.enum(["INACTIVE", "ACTIVE", "EXPIRED"]);
const isoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);

    return (
      !Number.isNaN(parsed.getTime()) &&
      parsed.toISOString().slice(0, 10) === value
    );
  });
const finiteNumberSchema = z.number().finite();
const prismaDecimalSchema = z
  .custom<Prisma.Decimal>(
    (value) =>
      Prisma.Decimal.isDecimal(value) && value.isFinite(),
    "Expected a finite Prisma Decimal.",
  )
  .transform((value) => value.toNumber())
  .refine(Number.isFinite, "Expected a safely representable number.");
const predictionPointSchema = z
  .object({
    date: isoDateSchema,
    weightKg: finiteNumberSchema,
  })
  .strict();
const protectedDataSchema = z
  .object({
    basalMetabolicRate: finiteNumberSchema,
    totalDailyEnergyExpenditure: finiteNumberSchema,
    weeklyWeightChangeKg: finiteNumberSchema,
    disclaimer: z.string().trim().min(1),
    predictionCurve: z.array(predictionPointSchema),
  })
  .strict();
const storedResultFields = {
  id: z.string().min(1),
  sessionId: z.string().min(1),
  algorithmVersion: z.string().min(1),
  bmi: prismaDecimalSchema,
  dailyCalories: prismaDecimalSchema,
  bmiCategory: bmiCategorySchema,
  estimatedTargetDate: z.date().nullable(),
  protectedData: protectedDataSchema,
  createdAt: z.date(),
};
const storedResultSchema = z.object(storedResultFields).strict();
const authorizedStoredResultSchema = z
  .object({
    ...storedResultFields,
    session: z
      .object({
        subscription: z
          .object({
            status: subscriptionStatusSchema,
            expiresAt: z.date().nullable(),
          })
          .strict()
          .nullable(),
      })
      .strict(),
  })
  .strict();

const authorizedResultSelect = {
  id: true,
  sessionId: true,
  algorithmVersion: true,
  bmi: true,
  dailyCalories: true,
  bmiCategory: true,
  estimatedTargetDate: true,
  protectedData: true,
  createdAt: true,
  session: {
    select: {
      subscription: {
        select: {
          status: true,
          expiresAt: true,
        },
      },
    },
  },
} satisfies Prisma.AssessmentResultSelect;

type ParsedStoredResult = z.output<typeof storedResultSchema>;
type ParsedAuthorizedStoredResult = z.output<
  typeof authorizedStoredResultSchema
>;

function invalidResultData(): AppError {
  return new AppError(
    "RESULT_DATA_INVALID",
    "Stored assessment result data is invalid.",
    500,
  );
}

function resultNotFound(): AppError {
  return new AppError(
    "RESULT_NOT_FOUND",
    "The assessment result was not found.",
    404,
  );
}

function parseStoredResult(result: unknown): ParsedStoredResult {
  const parsed = storedResultSchema.safeParse(result);
  if (!parsed.success) throw invalidResultData();

  return parsed.data;
}

function parseAuthorizedStoredResult(
  result: unknown,
): ParsedAuthorizedStoredResult {
  const parsed = authorizedStoredResultSchema.safeParse(result);
  if (!parsed.success) throw invalidResultData();

  return parsed.data;
}

function bmiCategoryLabel(category: string): string {
  switch (category) {
    case "underweight":
      return "偏瘦";
    case "normal":
      return "正常";
    case "overweight":
      return "超重";
    case "obese":
      return "肥胖";
    default:
      return category;
  }
}

function previewFromParsed(result: ParsedStoredResult) {
  return {
    access: "preview" as const,
    id: result.id,
    bmi: result.bmi,
    bmiCategory: result.bmiCategory,
    summary: `您的 BMI 是 ${result.bmi}，属于${bmiCategoryLabel(result.bmiCategory)}范围。`,
    lockedFeatures: [...PROTECTED_RESULT_KEYS],
    upgradeRequired: true as const,
    disclaimer: result.protectedData.disclaimer,
  };
}

function premiumFromParsed(result: ParsedStoredResult) {
  return {
    access: "premium" as const,
    id: result.id,
    bmi: result.bmi,
    bmiCategory: result.bmiCategory,
    recommendedDailyCalories: result.dailyCalories,
    basalMetabolicRate: result.protectedData.basalMetabolicRate,
    totalDailyEnergyExpenditure:
      result.protectedData.totalDailyEnergyExpenditure,
    estimatedTargetDate:
      result.estimatedTargetDate === null
        ? null
        : result.estimatedTargetDate.toISOString().slice(0, 10),
    weeklyWeightChangeKg: result.protectedData.weeklyWeightChangeKg,
    predictionCurve: result.protectedData.predictionCurve,
    disclaimer: result.protectedData.disclaimer,
    upgradeRequired: false as const,
  };
}

export function buildPreviewResult(result: unknown) {
  return previewFromParsed(parseStoredResult(result));
}

export function buildPremiumResult(result: unknown) {
  return premiumFromParsed(parseStoredResult(result));
}

function hasPremiumAccess(
  subscription: ParsedAuthorizedStoredResult["session"]["subscription"],
  now: Date,
) {
  return (
    subscription?.status === "ACTIVE" &&
    (subscription.expiresAt === null || subscription.expiresAt > now)
  );
}

export async function getAuthorizedResult(
  request: Request,
  sessionId: string,
  now: Date = new Date(),
) {
  await requireSessionAccess(request, sessionId);

  const storedResult = await prisma.assessmentResult.findUnique({
    where: { sessionId },
    select: authorizedResultSelect,
  });
  if (!storedResult) throw resultNotFound();

  const parsed = parseAuthorizedStoredResult(storedResult);

  return hasPremiumAccess(parsed.session.subscription, now)
    ? premiumFromParsed(parsed)
    : previewFromParsed(parsed);
}
