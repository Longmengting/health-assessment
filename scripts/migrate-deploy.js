// Runs `prisma migrate deploy` during Vercel builds only.
// Locally and in CI (no cloud database detected) it is a no-op.
/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require("node:child_process");

// Migrations require a direct (non-pooled) connection. Neon / Vercel Postgres
// expose this under provider-specific names, so check known names first and
// then scan the environment for a direct postgres:// URL.
function resolveDirectUrl(env) {
  const preferred = [
    "POSTGRES_URL_NON_POOLING",
    "DATABASE_URL_UNPOOLED",
    "STORAGE_POSTGRES_URL_NON_POOLING",
    "STORAGE_DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "DATABASE_URL",
    "STORAGE_POSTGRES_URL",
    "STORAGE_DATABASE_URL",
    "STORAGE_URL",
  ];

  for (const key of preferred) {
    const value = env[key];
    if (value && /^postgres(ql)?:\/\//.test(value)) return value;
  }

  let direct;
  let anyUrl;
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== "string" || !/^postgres(ql)?:\/\//.test(value)) continue;
    if (/(NON_POOLING|UNPOOLED)/i.test(key) && !direct) direct = value;
    if (!anyUrl) anyUrl = value;
  }
  return direct || anyUrl;
}

const directUrl = resolveDirectUrl(process.env);

if (process.env.VERCEL && directUrl) {
  console.log("Cloud Postgres detected, running prisma migrate deploy...");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: directUrl },
  });
  console.log("Migrations applied successfully.");
} else {
  console.log("No cloud database detected, skipping migrations.");
}
