import { describe, expect, it } from "vitest";

import { APP_NAME } from "../../src/lib/app-config";

describe("application configuration", () => {
  it("identifies the application for user-facing foundations", () => {
    expect(APP_NAME).toBe("健康路径");
  });
});
