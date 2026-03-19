/**
 * Core tool tests — config validation, architecture integrity,
 * diff logic, and audit issue detection.
 *
 * These tests work with synthetic data — no live GTM connection needed.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, unlinkSync, existsSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════════════════════════════════════════════════
// CONFIG VALIDATION
// ═══════════════════════════════════════════════════════════

describe("Config Validation", () => {
  const tmpConfigDir = "/tmp/gtm-test-config";
  const tmpConfigPath = resolve(tmpConfigDir, ".gtmrc.json");

  // Mock process.cwd so tests don't accidentally read the developer's real .gtmrc.json
  beforeEach(() => {
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/nonexistent-directory-for-tests");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("loadConfig throws when no config file exists", async () => {
    const { loadConfig } = await import("../lib/config.js");
    // Should throw a clear error telling user to run init
    expect(() => loadConfig()).toThrow("No .gtmrc.json found");
  });

  it("GtmConfig requires accountId, containerId, workspaceId", async () => {
    const { loadConfig } = await import("../lib/config.js");
    // Without a config file, loadConfig must throw
    expect(() => loadConfig()).toThrow();
  });

  it("writeConfig validates before writing", async () => {
    const { writeConfig } = await import("../lib/config.js");
    // @ts-expect-error: intentionally passing invalid config
    expect(() => writeConfig({ accountId: "" })).toThrow();
  });

  it("hasConfig returns boolean", async () => {
    const { hasConfig } = await import("../lib/config.js");
    expect(typeof hasConfig()).toBe("boolean");
  });
});

describe("Config Profile Resolution", () => {
  const tmpConfigDir = "/tmp/gtm-test-config-profiles";
  const tmpConfigPath = resolve(tmpConfigDir, ".gtmrc.json");

  beforeEach(() => {
    mkdirSync(tmpConfigDir, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(tmpConfigDir);
  });

  afterEach(() => {
    if (existsSync(tmpConfigPath)) unlinkSync(tmpConfigPath);
    vi.restoreAllMocks();
  });

  it("treats default as the base config", async () => {
    writeFileSync(
      tmpConfigPath,
      JSON.stringify({
        accountId: "111",
        containerId: "222",
        workspaceId: "1",
        ga4MeasurementId: "G-BASE",
      }),
    );

    const { loadConfig } = await import("../lib/config.js");
    expect(loadConfig("default")).toEqual(loadConfig());
  });

  it("returns dashboard-ready profile objects", async () => {
    writeFileSync(
      tmpConfigPath,
      JSON.stringify({
        accountId: "111",
        containerId: "222",
        workspaceId: "1",
        ga4MeasurementId: "G-BASE",
        profiles: [
          {
            name: "staging",
            accountId: "333",
            containerId: "444",
            workspaceId: "2",
            metaPixelId: "12345",
          },
        ],
      }),
    );

    const { listProfileConfigs } = await import("../lib/config.js");
    const profiles = listProfileConfigs();

    expect(profiles.map((profile) => profile.name)).toEqual(["default", "staging"]);
    expect(profiles[0]).toMatchObject({
      accountId: "111",
      containerId: "222",
      workspaceId: "1",
      ga4MeasurementId: "G-BASE",
    });
    expect(profiles[1]).toMatchObject({
      name: "staging",
      accountId: "333",
      containerId: "444",
      workspaceId: "2",
      metaPixelId: "12345",
    });
  });
});

// ═══════════════════════════════════════════════════════════
// ARCHITECTURE INTEGRITY
// ═══════════════════════════════════════════════════════════

describe("Architecture Constants", () => {
  it("TRIGGER_MAP has all core e-commerce events", async () => {
    const { TRIGGER_MAP } = await import("../lib/architecture.js");
    const coreEvents = ["page_view", "view_item", "add_to_cart", "begin_checkout", "purchase"];
    for (const event of coreEvents) {
      expect(TRIGGER_MAP[event]).toBeDefined();
      expect(TRIGGER_MAP[event].id).toBeTruthy();
      expect(TRIGGER_MAP[event].name).toBeTruthy();
      expect(TRIGGER_MAP[event].event).toBeTruthy();
    }
  });

  it("TRIGGER_MAP entries have unique IDs", async () => {
    const { TRIGGER_MAP } = await import("../lib/architecture.js");
    const ids = Object.values(TRIGGER_MAP).map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("VARIABLE_MAP has ecommerce core variables", async () => {
    const { VARIABLE_MAP } = await import("../lib/architecture.js");
    expect(VARIABLE_MAP["ecommerce.value"]).toBeTruthy();
    expect(VARIABLE_MAP["ecommerce.currency"]).toBeTruthy();
    expect(VARIABLE_MAP["ecommerce.items"]).toBeTruthy();
    expect(VARIABLE_MAP["ecommerce.transaction_id"]).toBeTruthy();
  });

  it("ACTION_TO_TRIGGER maps all standard actions", async () => {
    const { ACTION_TO_TRIGGER } = await import("../lib/architecture.js");
    const actions = ["purchase", "page_view", "view_item", "add_to_cart", "begin_checkout"];
    for (const action of actions) {
      expect(ACTION_TO_TRIGGER[action]).toBeTruthy();
    }
  });

  it("BUILTIN_TRIGGER_IDS contains All Pages trigger", async () => {
    const { BUILTIN_TRIGGER_IDS } = await import("../lib/architecture.js");
    expect(BUILTIN_TRIGGER_IDS.has("2147479553")).toBe(true); // All Pages
  });

  it("NAMING helpers produce correct prefixes", async () => {
    const { NAMING } = await import("../lib/architecture.js");
    expect(NAMING.variable.dataLayer("test")).toBe("DLV - test");
    expect(NAMING.variable.customJs("test")).toBe("CJS - test");
    expect(NAMING.trigger.customEvent("Purchase")).toBe("CE - Purchase");
    expect(NAMING.tag.ga4("Purchase")).toBe("GA4 - Purchase");
  });
});

// ═══════════════════════════════════════════════════════════
// GTM CLI ERROR HANDLING
// ═══════════════════════════════════════════════════════════

describe("GTM CLI Error Handling", () => {
  it("TagOpsError has message and code properties", async () => {
    const { TagOpsError, ErrorCode } = await import("../lib/errors.js");
    const error = new TagOpsError({ code: ErrorCode.INTERNAL_ERROR, message: "test error" });
    expect(error.message).toBe("test error");
    expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(error.name).toBe("TagOpsError");
  });

  it("buildConsentConfig produces valid consent structure", async () => {
    const { buildConsentConfig } = await import("../lib/gtm-cli.js");
    const consent = buildConsentConfig("ad_storage");
    expect(consent.consentStatus).toBe("needed");
    expect(consent.consentType?.list?.[0]?.value).toBe("ad_storage");
  });

  it("buildHtmlTagConfig produces valid config object", async () => {
    const { buildHtmlTagConfig } = await import("../lib/gtm-cli.js");
    const config = buildHtmlTagConfig("<script>test</script>", "ad_storage");
    expect(config.parameter).toBeDefined();
    const params = config.parameter as Array<{ key: string; value: string }>;
    expect(params.find((p) => p.key === "html")?.value).toBe("<script>test</script>");
    expect(params.find((p) => p.key === "supportDocumentWrite")?.value).toBe("false");
    expect(config.consentSettings).toBeDefined();
  });

  it("buildHtmlTagConfig without consent omits consentSettings", async () => {
    const { buildHtmlTagConfig } = await import("../lib/gtm-cli.js");
    const config = buildHtmlTagConfig("<script>test</script>");
    expect(config.consentSettings).toBeUndefined();
  });

  it("createTag rejects empty name", async () => {
    const { createTag } = await import("../lib/gtm-cli.js");
    const { TagOpsError } = await import("../lib/errors.js");
    await expect(
      createTag({ name: "", type: "html", firingTriggerId: "35", config: {} }),
    ).rejects.toThrow(TagOpsError);
  });

  it("createTag rejects empty firingTriggerId", async () => {
    const { createTag } = await import("../lib/gtm-cli.js");
    const { TagOpsError } = await import("../lib/errors.js");
    await expect(
      createTag({ name: "test", type: "html", firingTriggerId: "", config: {} }),
    ).rejects.toThrow(TagOpsError);
  });

  it("updateTag rejects empty tagId", async () => {
    const { updateTag } = await import("../lib/gtm-cli.js");
    const { TagOpsError } = await import("../lib/errors.js");
    await expect(
      updateTag({ tagId: "", name: "test", fingerprint: "fp", config: {} }),
    ).rejects.toThrow(TagOpsError);
  });

  it("getTag returns null for empty ID", async () => {
    const { getTag } = await import("../lib/gtm-cli.js");
    expect(await getTag("")).toBeNull();
  });

  it("getTrigger returns null for empty ID", async () => {
    const { getTrigger } = await import("../lib/gtm-cli.js");
    expect(await getTrigger("")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// DEPLOY MANIFEST VALIDATION
// ═══════════════════════════════════════════════════════════

describe("Deploy Manifest Validation", () => {
  const testPath = "/tmp/test-deploy-core.json";

  it("rejects non-existent file path", async () => {
    const { loadManifest } = await import("../tools/deploy.js");
    expect(() => loadManifest("/tmp/nonexistent-manifest.json")).toThrow("not found");
  });

  it("rejects manifest without templates array", async () => {
    const { loadManifest } = await import("../tools/deploy.js");
    writeFileSync(testPath, JSON.stringify({ name: "test" }));
    expect(() => loadManifest(testPath)).toThrow("templates");
    if (existsSync(testPath)) unlinkSync(testPath);
  });
});

// ═══════════════════════════════════════════════════════════
// FIX-CONSENT / FIX-TRIGGERS VALIDATION
// ═══════════════════════════════════════════════════════════

describe("Fix-Consent Validation", () => {
  it("throws when no tag IDs provided", async () => {
    const { fixConsent } = await import("../tools/fix-consent.js");
    await expect(fixConsent([])).rejects.toThrow("No tag IDs");
  });
});

describe("Fix-Triggers Validation", () => {
  it("throws when no mapping provided", async () => {
    const { fixTriggers } = await import("../tools/fix-triggers.js");
    await expect(fixTriggers({})).rejects.toThrow("No tag-trigger mapping");
  });
});
