/**
 * Tests for new features: preview, validate, and deploy.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  previewTemplate,
  validateInstalledTags,
  listTemplates,
  installTemplate,
} from "../templates/registry.js";
import { loadManifest, createStarterManifest, deployManifest } from "../tools/deploy.js";

// ═══════════════════════════════════════════════════════════
// PREVIEW TESTS
// ═══════════════════════════════════════════════════════════

describe("Template Preview", () => {
  it("returns full metadata for Meta Pixel", () => {
    const result = previewTemplate("meta-pixel", { pixelId: "123456789" });
    expect(result.templateId).toBe("meta-pixel");
    expect(result.templateName).toBe("Meta Pixel (Facebook)");
    expect(result.vendor).toBe("Meta");
    expect(result.category).toBe("advertising");
    expect(result.tags.length).toBe(5);
    expect(result.requiredInputs.length).toBeGreaterThan(0);
  });

  it("all tags include HTML content", () => {
    const result = previewTemplate("meta-pixel", { pixelId: "123456789" });
    for (const tag of result.tags) {
      if (tag.type === "html") {
        expect(tag.html.length).toBeGreaterThan(0);
      }
    }
  });

  it("uses example values when no pixel ID provided", () => {
    const result = previewTemplate("klaviyo");
    expect(result.tags.length).toBe(1);
    // Should use the example value from requiredInputs
    expect(result.tags[0].html).toContain(result.requiredInputs[0].example);
  });

  it("Shopify preview includes all 8 event subscriptions", () => {
    const result = previewTemplate("shopify-custom-pixel", { pixelId: "GTM-TEST123" });
    expect(result.tags.length).toBe(1);
    const html = result.tags[0].html;
    expect(html).toContain("page_viewed");
    expect(html).toContain("product_viewed");
    expect(html).toContain("collection_viewed");
    expect(html).toContain("search_submitted");
    expect(html).toContain("cart_viewed");
    expect(html).toContain("checkout_started");
    expect(html).toContain("payment_info_submitted");
    expect(html).toContain("checkout_completed");
    expect(html).toContain("GTM-TEST123");
  });

  it("throws on unknown template ID", () => {
    expect(() => previewTemplate("nonexistent-template")).toThrow();
  });

  it("all templates can be previewed", () => {
    const templates = listTemplates();
    for (const t of templates) {
      const result = previewTemplate(t.id, { pixelId: "TEST123" });
      expect(result.tags.length).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// VALIDATE TESTS
// ═══════════════════════════════════════════════════════════

describe("Template Validation", () => {
  it("passes when all expected tags are present", () => {
    // Use preview to get exact tag names
    const preview = previewTemplate("meta-pixel", { pixelId: "123456" });
    const installedTags = preview.tags.map((t) => ({
      name: t.name,
      type: t.type,
      html: t.html,
      consentType: t.consentType ?? "ad_storage",
      triggerEvent: t.triggerEvent,
    }));
    const result = validateInstalledTags("meta-pixel", installedTags, {
      pixelId: "123456",
    });
    expect(result.status).toBe("pass");
    expect(result.matched).toBe(5);
    expect(result.issues.length).toBe(0);
  });

  it("fails when tags are missing", () => {
    const installedTags = [
      { name: "Meta Pixel + PageView", type: "html", consentType: "ad_storage" },
    ];
    const result = validateInstalledTags("meta-pixel", installedTags, {
      pixelId: "123456",
    });
    expect(result.status).toBe("fail");
    expect(result.issues.some((i) => i.type === "missing")).toBe(true);
  });

  it("warns on consent mismatch", () => {
    // Get exact names from preview, then change one consent type
    const preview = previewTemplate("meta-pixel", { pixelId: "123456" });
    const installedTags = preview.tags.map((t, i) => ({
      name: t.name,
      type: t.type,
      html: t.html,
      consentType: i === 0 ? "analytics_storage" : "ad_storage", // First tag has wrong consent
      triggerEvent: t.triggerEvent,
    }));
    const result = validateInstalledTags("meta-pixel", installedTags, {
      pixelId: "123456",
    });
    expect(result.status).toBe("warn");
    expect(result.issues.some((i) => i.type === "consent_mismatch")).toBe(true);
  });

  it("fails on HTML mismatch with actionable diagnostics", () => {
    const preview = previewTemplate("meta-pixel", { pixelId: "123456" });
    const installedTags = preview.tags.map((t, i) => ({
      name: t.name,
      type: t.type,
      html: i === 0 ? "<script>fbq('track','PageView');</script>" : t.html,
      consentType: t.consentType ?? "ad_storage",
      triggerEvent: t.triggerEvent,
    }));
    const result = validateInstalledTags("meta-pixel", installedTags, {
      pixelId: "123456",
    });
    expect(result.status).toBe("fail");
    expect(result.issues.some((i) => i.type === "html_mismatch")).toBe(true);
    expect(result.issues.find((i) => i.type === "html_mismatch")?.recommendation).toBeTruthy();
  });

  it("fails on trigger mismatch", () => {
    const preview = previewTemplate("meta-pixel", { pixelId: "123456" });
    const installedTags = preview.tags.map((t, i) => ({
      name: t.name,
      type: t.type,
      html: t.html,
      consentType: t.consentType ?? "ad_storage",
      triggerEvent: i === 0 ? "purchase" : t.triggerEvent,
    }));
    const result = validateInstalledTags("meta-pixel", installedTags, {
      pixelId: "123456",
    });
    expect(result.status).toBe("fail");
    expect(result.issues.some((i) => i.type === "trigger_mismatch")).toBe(true);
  });

  it("flags extra tags from the same vendor", () => {
    const installedTags = [
      { name: "Klaviyo Tracking", type: "html" },
      { name: "Klaviyo Old Script", type: "html" }, // Extra
    ];
    const result = validateInstalledTags("klaviyo", installedTags, {
      pixelId: "SFwUtB",
    });
    expect(result.issues.some((i) => i.type === "extra_tag")).toBe(true);
  });

  it("validate works for all templates", () => {
    const templates = listTemplates();
    for (const t of templates) {
      const result = validateInstalledTags(t.id, [], { pixelId: "TEST" });
      // With empty installed tags, all should fail (missing tags)
      expect(result.status).toBe("fail");
      expect(result.total).toBeGreaterThan(0);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// DEPLOY MANIFEST TESTS
// ═══════════════════════════════════════════════════════════

describe("Deploy Manifest", () => {
  const testManifestPath = resolve("/tmp/test-deploy-manifest.json");

  it("creates a starter manifest with all templates", () => {
    const path = createStarterManifest(testManifestPath);
    expect(existsSync(path)).toBe(true);

    const manifest = JSON.parse(readFileSync(path, "utf-8"));
    expect(manifest.name).toBeTruthy();
    expect(manifest.templates.length).toBe(listTemplates().length);

    // All should start disabled
    for (const t of manifest.templates) {
      expect(t.disabled).toBe(true);
      expect(t.pixelId).toBeTruthy();
    }
  });

  it("loads and validates a manifest", () => {
    const manifest = {
      name: "Test Deploy",
      templates: [
        { id: "meta-pixel", pixelId: "123456" },
        { id: "klaviyo", pixelId: "SFwUtB" },
      ],
    };
    writeFileSync(testManifestPath, JSON.stringify(manifest));

    const loaded = loadManifest(testManifestPath);
    expect(loaded.name).toBe("Test Deploy");
    expect(loaded.templates.length).toBe(2);
  });

  it("rejects manifest with unknown template ID", () => {
    const manifest = {
      name: "Bad Deploy",
      templates: [{ id: "nonexistent-template", pixelId: "123" }],
    };
    writeFileSync(testManifestPath, JSON.stringify(manifest));

    expect(() => loadManifest(testManifestPath)).toThrow("Unknown template");
  });

  it("rejects manifest with missing pixelId", () => {
    const manifest = {
      name: "Bad Deploy",
      templates: [{ id: "meta-pixel" }],
    };
    writeFileSync(testManifestPath, JSON.stringify(manifest));

    expect(() => loadManifest(testManifestPath)).toThrow("missing required 'pixelId'");
  });

  it("deploys multiple templates in dry-run", async () => {
    const manifest = {
      name: "Test Deploy",
      templates: [
        { id: "meta-pixel", pixelId: "123456" },
        { id: "klaviyo", pixelId: "SFwUtB" },
        { id: "reddit-pixel", pixelId: "t2_test" },
      ],
    };
    writeFileSync(testManifestPath, JSON.stringify(manifest));

    const result = await deployManifest(testManifestPath, { dryRun: true });
    expect(result.manifestName).toBe("Test Deploy");
    expect(result.dryRun).toBe(true);
    expect(result.results.length).toBe(3);
    expect(result.summary.succeeded).toBe(3);
    expect(result.summary.failed).toBe(0);
    expect(result.summary.totalTags).toBeGreaterThan(0);
  });

  it("skips disabled templates", async () => {
    const manifest = {
      name: "Partial Deploy",
      templates: [
        { id: "meta-pixel", pixelId: "123456" },
        { id: "klaviyo", pixelId: "SFwUtB", disabled: true },
      ],
    };
    writeFileSync(testManifestPath, JSON.stringify(manifest));

    const result = await deployManifest(testManifestPath, { dryRun: true });
    expect(result.results.length).toBe(1); // Only meta-pixel
    expect(result.summary.skipped).toBe(1);
  });

  // Cleanup
  it("cleanup test files", () => {
    if (existsSync(testManifestPath)) unlinkSync(testManifestPath);
  });
});
