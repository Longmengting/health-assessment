import { afterEach, describe, expect, it } from "vitest";

import { resetTestDatabase } from "../helpers/database";

const originalDatabaseUrl = process.env.DATABASE_URL;
const originalTestDatabaseUrl = process.env.TEST_DATABASE_URL;

afterEach(() => {
  if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = originalDatabaseUrl;

  if (originalTestDatabaseUrl === undefined) delete process.env.TEST_DATABASE_URL;
  else process.env.TEST_DATABASE_URL = originalTestDatabaseUrl;
});

describe("test database reset helper", () => {
  it("refuses to fall back to DATABASE_URL when TEST_DATABASE_URL is missing", async () => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/health_path_test";
    delete process.env.TEST_DATABASE_URL;

    await expect(resetTestDatabase()).rejects.toThrow(
      "TEST_DATABASE_URL must be set before resetting test data.",
    );
  });

  it("refuses a development database URL without a test marker", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/health_path_development";

    await expect(resetTestDatabase()).rejects.toThrow(
      "TEST_DATABASE_URL must identify a dedicated test database.",
    );
  });

  it("ignores test markers outside the database path", async () => {
    process.env.TEST_DATABASE_URL =
      "postgresql://test_user:postgres@127.0.0.1:1/health_path_development?schema=test_schema";

    await expect(resetTestDatabase()).rejects.toThrow(
      "TEST_DATABASE_URL must identify a dedicated test database.",
    );
  });
});
