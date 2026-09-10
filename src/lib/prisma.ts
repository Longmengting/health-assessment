import { PrismaClient } from "@prisma/client";

// Resolve the Postgres connection string from whichever variable the hosting
// provider injected. Neon / Vercel Postgres may use a custom prefix or naming
// scheme, so we check known names first and then scan the environment for any
// postgres:// URL as a last resort. This keeps the app working both locally
// (localhost DATABASE_URL) and on Vercel (managed Postgres).
function resolveDatabaseUrl(): string | undefined {
  const env = process.env;
  const preferred = [
    "POSTGRES_PRISMA_URL",
    "DATABASE_URL",
    "POSTGRES_URL",
    "STORAGE_POSTGRES_PRISMA_URL",
    "STORAGE_DATABASE_URL",
    "STORAGE_URL",
  ];

  for (const key of preferred) {
    const value = env[key];
    if (value && /^postgres(ql)?:\/\//.test(value)) return value;
  }

  let pooled: string | undefined;
  let anyUrl: string | undefined;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || !/^postgres(ql)?:\/\//.test(value)) continue;
    // A Prisma-ready URL is the best match.
    if (/PRISMA/i.test(key)) return value;
    const isDirect = /(NON_POOLING|UNPOOLED)/i.test(key);
    if (!isDirect && !pooled) pooled = value;
    if (!anyUrl) anyUrl = value;
  }
  return pooled ?? anyUrl;
}

const databaseUrl = resolveDatabaseUrl();

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient(
    databaseUrl ? { datasourceUrl: databaseUrl } : undefined
  );

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
