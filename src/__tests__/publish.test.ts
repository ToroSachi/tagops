/**
 * Tests for publish tool.
 */

import { describe, it, expect } from "vitest";

describe("Publish Tool", () => {
  it("dry-run returns correct result without calling GTM", async () => {
    const { runPublish } = await import("../tools/publish.js");
    const result = await runPublish({
      name: "v1.5 — Test Release",
      description: "Testing dry run",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.versionName).toBe("v1.5 — Test Release");
    expect(result.versionDescription).toBe("Testing dry run");
    expect(result.published).toBe(false);
    expect(result.versionId).toBeUndefined();
  });

  it("rejects empty version name", async () => {
    const { runPublish } = await import("../tools/publish.js");
    const result = await runPublish({ name: "" });
    expect(result.error).toContain("required");
  });
});
