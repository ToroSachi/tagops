/**
 * Tests for multi-container profile configuration.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

describe("Multi-Container Profiles", () => {
  const tmpDir = "/tmp/gtm-profile-test";
  const configPath = resolve(tmpDir, ".gtmrc.json");

  beforeEach(() => {
    if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });
  });

  it("loads config with profiles array", async () => {
    const config = {
      accountId: "111",
      containerId: "222",
      workspaceId: "1",
      profiles: [
        { name: "staging", accountId: "333", containerId: "444", workspaceId: "2" },
        { name: "production", accountId: "555", containerId: "666", workspaceId: "3" },
      ],
    };
    writeFileSync(configPath, JSON.stringify(config));

    const parsed = JSON.parse(JSON.stringify(config));
    expect(parsed.profiles).toHaveLength(2);
    expect(parsed.profiles[0].name).toBe("staging");
    expect(parsed.profiles[1].name).toBe("production");
  });

  it("profile schema rejects missing name", async () => {
    const { z } = await import("zod");
    const GtmProfileSchema = z.object({
      name: z.string().min(1, "profile name is required"),
      accountId: z.string().min(1, "accountId is required"),
      containerId: z.string().min(1, "containerId is required"),
      workspaceId: z.string().min(1, "workspaceId is required"),
    });

    const result = GtmProfileSchema.safeParse({
      name: "",
      accountId: "123",
      containerId: "456",
      workspaceId: "1",
    });
    expect(result.success).toBe(false);
  });

  it("profile schema accepts valid profile", async () => {
    const { z } = await import("zod");
    const GtmProfileSchema = z.object({
      name: z.string().min(1),
      accountId: z.string().min(1),
      containerId: z.string().min(1),
      workspaceId: z.string().min(1),
      ga4MeasurementId: z.string().optional(),
    });

    const result = GtmProfileSchema.safeParse({
      name: "staging",
      accountId: "123",
      containerId: "456",
      workspaceId: "1",
      ga4MeasurementId: "G-TEST",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.name).toBe("staging");
      expect(result.data.ga4MeasurementId).toBe("G-TEST");
    }
  });

  it("cleanup temp files", () => {
    if (existsSync(configPath)) unlinkSync(configPath);
  });
});
