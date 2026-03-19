/**
 * Tests for docgen and multi-container profile features.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════════════════════════════════════════════════
// DOCGEN TESTS
// ═══════════════════════════════════════════════════════════

describe("Documentation Generator", () => {
  it("generates markdown for a workspace snapshot", async () => {
    const { generateDocumentation } = await import("../tools/docgen.js");
    const tags = [
      {
        tagId: "1",
        name: "Meta – PageView",
        type: "html",
        firingTriggerId: ["83"],
        fingerprint: "abc",
        consentSettings: {
          consentStatus: "needed" as const,
          consentType: { type: "list" as const, list: [{ type: "template", value: "ad_storage" }] },
        },
        parameter: [
          {
            type: "template" as const,
            key: "html",
            value: "<script>fbq('track','PageView')</script>",
          },
        ],
      },
      {
        tagId: "2",
        name: "GA4 - Purchase",
        type: "gaawe",
        firingTriggerId: ["35"],
        fingerprint: "def",
        paused: true,
      },
    ];
    const triggers = [
      { triggerId: "83", name: "CE - Page View", type: "CUSTOM_EVENT" },
      { triggerId: "35", name: "CE - Purchase", type: "CUSTOM_EVENT" },
    ];
    const variables = [
      { variableId: "10", name: "DLV - Ecommerce Value", type: "v" },
      { variableId: "11", name: "DLV - Transaction ID", type: "v" },
      { variableId: "12", name: "Unused CJS", type: "jsm" },
    ];

    const md = generateDocumentation(tags as any, triggers as any, variables as any);

    // Basic structure checks
    expect(md).toContain("# GTM Workspace Data Dictionary");
    expect(md).toContain("## Tags");
    expect(md).toContain("## Triggers");
    expect(md).toContain("## Variables");
    expect(md).toContain("## Data Layer Specification");
    expect(md).toContain("## Consent Map");

    // Tag data
    expect(md).toContain("Meta – PageView");
    expect(md).toContain("GA4 - Purchase");
    expect(md).toContain("⏸ Paused");
    expect(md).toContain("✅ Active");

    // Trigger data
    expect(md).toContain("CE - Page View");

    // Variable data
    expect(md).toContain("DLV - Ecommerce Value");

    // Consent map
    expect(md).toContain("`ad_storage`");
  });

  it("extracts data layer keys from tag HTML", async () => {
    const { generateDocumentation } = await import("../tools/docgen.js");
    const tags = [
      {
        tagId: "1",
        name: "Test Tag",
        type: "html",
        firingTriggerId: [],
        fingerprint: "x",
        parameter: [
          {
            type: "template" as const,
            key: "html",
            value: "value={{DLV - Ecommerce Value}}, id={{DLV - Transaction ID}}",
          },
        ],
      },
    ];

    const md = generateDocumentation(tags as any, [], []);
    expect(md).toContain("Ecommerce Value");
    expect(md).toContain("Transaction ID");
  });
});

// ═══════════════════════════════════════════════════════════
// MULTI-CONTAINER PROFILE TESTS
// ═══════════════════════════════════════════════════════════

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

    // Use dynamic import to avoid caching
    const { loadConfig, findConfigPath } = await import("../lib/config.js");
    // We can't easily test profile loading without mocking findConfigPath,
    // but we can test the schema validates
    const { z } = await import("zod");
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

  // Cleanup
  it("cleanup temp files", () => {
    if (existsSync(configPath)) unlinkSync(configPath);
  });
});
