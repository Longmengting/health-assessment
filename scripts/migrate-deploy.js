// Runs `prisma migrate deploy` during Vercel builds only.
// Locally and in CI (no cloud database detected) it is a no-op.
/* eslint-disable @typescript-eslint/no-require-imports */
const { execSync } = require("node:child_process");

const hasVercelPostgres = Boolean(
  process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_PRISMA_URL ||
    process.env.POSTGRES_URL
);

if (process.env.VERCEL && hasVercelPostgres) {
  const directUrl =
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.POSTGRES_URL;
  console.log("Vercel Postgres detected, running prisma migrate deploy...");
  execSync("npx prisma migrate deploy", {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: directUrl },
  });
  console.log("Migrations applied successfully.");
} else {
  console.log("No cloud database detected, skipping migrations.");
}
