import { PrismaClient } from "@prisma/client";

// Prefer Vercel Postgres injected URLs over DATABASE_URL so the app works
// both locally (localhost DATABASE_URL) and on Vercel (managed Postgres).
const databaseUrl =
  process.env.POSTGRES_PRISMA_URL ||
  process.env.POSTGRES_URL ||
  process.env.DATABASE_URL;

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    databaseUrl ? { datasourceUrl: databaseUrl } : undefined
  );

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
