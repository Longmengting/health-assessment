import { PrismaClient } from "@prisma/client";

const TEST_DATABASE_MARKERS = ["_test", "-test", "/test", "test_"];
const TEST_TABLES = [
  "PaymentEvent",
  "Subscription",
  "AssessmentResult",
  "AssessmentAnswer",
  "AssessmentSession",
];

function testDatabaseUrl() {
  const databaseUrl = process.env.TEST_DATABASE_URL;

  if (!databaseUrl) {
    throw new Error("TEST_DATABASE_URL must be set before resetting test data.");
  }

  let databasePath: string;

  try {
    const parsedUrl = new URL(databaseUrl);

    if (parsedUrl.protocol !== "postgresql:" && parsedUrl.protocol !== "postgres:") {
      throw new Error("Unexpected database protocol.");
    }

    databasePath = decodeURIComponent(parsedUrl.pathname).toLowerCase();
  } catch {
    throw new Error("TEST_DATABASE_URL must be a valid PostgreSQL URL.");
  }

  if (!TEST_DATABASE_MARKERS.some((marker) => databasePath.includes(marker))) {
    throw new Error("TEST_DATABASE_URL must identify a dedicated test database.");
  }

  return databaseUrl;
}

export async function resetTestDatabase() {
  const databaseUrl = testDatabaseUrl();
  const testPrisma = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    await testPrisma.$executeRawUnsafe(
      `TRUNCATE TABLE ${TEST_TABLES.map((table) => `"${table}"`).join(", ")} RESTART IDENTITY CASCADE`,
    );
  } finally {
    await testPrisma.$disconnect();
  }
}
