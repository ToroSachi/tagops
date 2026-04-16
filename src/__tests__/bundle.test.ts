/**
 * Tests for template bundles — multi-template manifests for agency installs
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createBundle, loadBundle } from "../templates/bundle.js";

describe("Template Bundles", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "tagops-bundle-test-"));

  describe("createBundle", () => {
    it("creates a bundle from multiple template entries", () => {
      const bundle = createBundle({
        name: "standard-ecom",
        entries: [
          { templateId: "meta-pixel", inputs: { pixelId: "123456789012345" } },
          { templateId: "ga4-ecommerce", inputs: { measurementId: "G-ABCDEF1234" } },
        ],
      });

      expect(bundle.version).toBe(1);
      expect(bundle.name).toBe("standard-ecom");
      expect(bundle.templates).toHaveLength(2);
      expect(bundle.templates[0].templateId).toBe("meta-pixel");
      expect(bundle.templates[1].templateId).toBe("ga4-ecommerce");
      expect(bundle.createdAt).toBeTruthy();
    });

    it("accepts custom description", () => {
      const bundle = createBundle({
        name: "test",
        description: "Custom description",
        entries: [{ templateId: "meta-pixel", inputs: { pixelId: "123456789012345" } }],
      });

      expect(bundle.description).toBe("Custom description");
    });

    it("generates default description when none provided", () => {
      const bundle = createBundle({
        name: "test",
        entries: [{ templateId: "meta-pixel", inputs: { pixelId: "123456789012345" } }],
      });

      expect(bundle.description).toContain("1 templates");
    });

    it("throws when name is missing", () => {
      expect(() =>
        createBundle({
          name: "",
          entries: [{ templateId: "meta-pixel", inputs: { pixelId: "123456789012345" } }],
        }),
      ).toThrow(/name is required/);
    });

    it("throws when entries is empty", () => {
      expect(() => createBundle({ name: "empty", entries: [] })).toThrow(/at least one template/);
    });

    it("throws for unknown template ID", () => {
      expect(() =>
        createBundle({
          name: "bad",
          entries: [{ templateId: "nonexistent", inputs: {} }],
        }),
      ).toThrow(/not found/);
    });

    it("hydrates each template with its specific inputs", () => {
      const bundle = createBundle({
        name: "multi",
        entries: [
          { templateId: "meta-pixel", inputs: { pixelId: "META_ID_111" } },
          { templateId: "tiktok-pixel", inputs: { pixelId: "TIKTOK_ID_222" } },
        ],
      });

      expect(bundle.templates[0].inputs.pixelId).toBe("META_ID_111");
      expect(bundle.templates[1].inputs.pixelId).toBe("TIKTOK_ID_222");
    });
  });

  describe("loadBundle", () => {
    it("loads a valid bundle file", () => {
      const bundle = createBundle({
        name: "roundtrip",
        entries: [{ templateId: "meta-pixel", inputs: { pixelId: "123456789012345" } }],
      });

      const filePath = join(tmpDir, "valid-bundle.json");
      writeFileSync(filePath, JSON.stringify(bundle, null, 2));

      const result = loadBundle(filePath);
      expect(result.valid).toBe(true);
      expect(result.bundle!.name).toBe("roundtrip");
      expect(result.bundle!.templates).toHaveLength(1);

      unlinkSync(filePath);
    });

    it("rejects non-existent file", () => {
      const result = loadBundle("/nonexistent/file.json");
      expect(result.valid).toBe(false);
      expect(result.errors[0].field).toBe("file");
    });

    it("rejects invalid JSON", () => {
      const filePath = join(tmpDir, "bad.json");
      writeFileSync(filePath, "{{{invalid");
      const result = loadBundle(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain("Invalid JSON");

      unlinkSync(filePath);
    });

    it("rejects bundle without name", () => {
      const filePath = join(tmpDir, "no-name.json");
      writeFileSync(filePath, JSON.stringify({ version: 1, templates: [] }));
      const result = loadBundle(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field === "name")).toBe(true);

      unlinkSync(filePath);
    });

    it("rejects empty templates array", () => {
      const filePath = join(tmpDir, "empty-templates.json");
      writeFileSync(filePath, JSON.stringify({ version: 1, name: "test", templates: [] }));
      const result = loadBundle(filePath);

      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("at least one"))).toBe(true);

      unlinkSync(filePath);
    });

    it("validates individual template entries", () => {
      const filePath = join(tmpDir, "bad-template.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          version: 1,
          name: "test",
          templates: [{ invalid: true }],
        }),
      );

      const result = loadBundle(filePath);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.field.includes("templates[0]"))).toBe(true);

      unlinkSync(filePath);
    });

    it("rejects future version", () => {
      const filePath = join(tmpDir, "future.json");
      writeFileSync(
        filePath,
        JSON.stringify({
          version: 999,
          name: "test",
          templates: [{ templateId: "x", tags: [] }],
        }),
      );

      const result = loadBundle(filePath);
      expect(result.valid).toBe(false);
      expect(result.errors.some((e) => e.message.includes("newer"))).toBe(true);

      unlinkSync(filePath);
    });
  });

  describe("3-template agency bundle", () => {
    it("creates full agency bundle with GA4 + Meta + TikTok", () => {
      const bundle = createBundle({
        name: "agency-standard-ecom",
        description: "Standard e-commerce tracking stack for Shopify stores",
        entries: [
          { templateId: "ga4-ecommerce", inputs: { measurementId: "G-ABCDEF1234" } },
          { templateId: "meta-pixel", inputs: { pixelId: "123456789012345" } },
          { templateId: "tiktok-pixel", inputs: { pixelId: "CXXXXXXXXXXXXXXXXX" } },
        ],
      });

      expect(bundle.templates).toHaveLength(3);

      const totalTags = bundle.templates.reduce((sum, t) => sum + t.tags.length, 0);
      expect(totalTags).toBeGreaterThan(10); // Should have 15+ tags combined

      // Each template should have independent inputs
      expect(bundle.templates[0].vendor).toBe("Google");
      expect(bundle.templates[1].vendor).toBe("Meta");
      expect(bundle.templates[2].vendor).toBe("TikTok");

      // Round-trip through file
      const filePath = join(tmpDir, "agency.bundle.json");
      writeFileSync(filePath, JSON.stringify(bundle, null, 2));

      const loaded = loadBundle(filePath);
      expect(loaded.valid).toBe(true);
      expect(loaded.bundle!.templates).toHaveLength(3);
      expect(loaded.bundle!.templates[0].templateId).toBe("ga4-ecommerce");

      unlinkSync(filePath);
    });
  });
});
