/**
 * Tests for template export/import (manifest system)
 */
import { describe, it, expect } from "vitest";
import { writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  exportTemplate,
  loadManifest,
  MANIFEST_VERSION,
  type TemplateManifest,
} from "../templates/manifest.js";

describe("Template Manifest — Export", () => {
  it("exports meta-pixel with all required fields", () => {
    const manifest = exportTemplate("meta-pixel", { pixelId: "123456789012345" });

    expect(manifest.version).toBe(MANIFEST_VERSION);
    expect(manifest.templateId).toBe("meta-pixel");
    expect(manifest.templateName).toContain("Meta");
    expect(manifest.vendor).toBe("Meta");
    expect(manifest.category).toBe("advertising");
    expect(manifest.inputs.pixelId).toBe("123456789012345");
    expect(manifest.generatedAt).toBeTruthy();
    expect(manifest.generatorVersion).toBeTruthy();
    expect(manifest.tags.length).toBeGreaterThan(0);
  });

  it("exports ga4-ecommerce with measurement ID", () => {
    const manifest = exportTemplate("ga4-ecommerce", { measurementId: "G-ABCDEF1234" });

    expect(manifest.templateId).toBe("ga4-ecommerce");
    expect(manifest.inputs.measurementId).toBe("G-ABCDEF1234");
    expect(manifest.tags.length).toBeGreaterThan(0);

    // GA4 tags should have consent types
    const tagsWithConsent = manifest.tags.filter((t) => t.consentType);
    expect(tagsWithConsent.length).toBeGreaterThan(0);
  });

  it("hydrates tags with the provided pixel ID", () => {
    const manifest = exportTemplate("meta-pixel", { pixelId: "TESTPIXELID999" });

    // At least one tag should reference the pixel ID in its HTML or config
    const tagContents = manifest.tags.map(
      (t) => JSON.stringify(t.html ?? "") + JSON.stringify(t.config ?? ""),
    );
    const hasPixelRef = tagContents.some((content) => content.includes("TESTPIXELID999"));
    expect(hasPixelRef).toBe(true);
  });

  it("includes trigger events for every tag", () => {
    const manifest = exportTemplate("tiktok-pixel", { pixelId: "CXXXXXXXXXXXXXXXXX" });

    for (const tag of manifest.tags) {
      expect(tag.triggerEvent).toBeTruthy();
      expect(typeof tag.triggerEvent).toBe("string");
    }
  });

  it("includes variables when template defines them", () => {
    // Most templates may not have variables, but the structure should be present
    const manifest = exportTemplate("meta-pixel", { pixelId: "123456789012345" });
    expect(Array.isArray(manifest.variables)).toBe(true);
  });

  it("throws for unknown template ID", () => {
    expect(() => exportTemplate("nonexistent-template", {})).toThrow(/not found/);
  });

  it("throws when required inputs are missing", () => {
    expect(() => exportTemplate("meta-pixel", {})).toThrow(/Missing required input/);
  });

  it("produces valid JSON that round-trips", () => {
    const manifest = exportTemplate("meta-pixel", { pixelId: "123456789012345" });
    const json = JSON.stringify(manifest);
    const parsed = JSON.parse(json) as TemplateManifest;

    expect(parsed.templateId).toBe(manifest.templateId);
    expect(parsed.tags.length).toBe(manifest.tags.length);
    expect(parsed.inputs.pixelId).toBe(manifest.inputs.pixelId);
  });
});

describe("Template Manifest — Import (loadManifest)", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "tagops-manifest-test-"));

  function writeTmpFile(name: string, content: string): string {
    const filePath = join(tmpDir, name);
    writeFileSync(filePath, content);
    return filePath;
  }

  it("loads a valid manifest file", () => {
    const manifest = exportTemplate("meta-pixel", { pixelId: "123456789012345" });
    const filePath = writeTmpFile("valid.json", JSON.stringify(manifest));

    const result = loadManifest(filePath);
    expect(result.valid).toBe(true);
    expect(result.manifest).toBeDefined();
    expect(result.manifest!.templateId).toBe("meta-pixel");

    unlinkSync(filePath);
  });

  it("rejects non-existent file", () => {
    const result = loadManifest("/nonexistent/path/to/file.json");
    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("file");
  });

  it("rejects invalid JSON", () => {
    const filePath = writeTmpFile("invalid.json", "this is not json {{{");
    const result = loadManifest(filePath);

    expect(result.valid).toBe(false);
    expect(result.errors[0].field).toBe("file");
    expect(result.errors[0].message).toContain("Invalid JSON");

    unlinkSync(filePath);
  });

  it("rejects manifest missing version", () => {
    const filePath = writeTmpFile(
      "no-version.json",
      JSON.stringify({ templateId: "test", templateName: "Test", tags: [] }),
    );

    const result = loadManifest(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "version")).toBe(true);

    unlinkSync(filePath);
  });

  it("rejects manifest with future version", () => {
    const filePath = writeTmpFile(
      "future.json",
      JSON.stringify({
        version: 999,
        templateId: "test",
        templateName: "Test",
        tags: [],
      }),
    );

    const result = loadManifest(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes("newer than supported"))).toBe(true);

    unlinkSync(filePath);
  });

  it("rejects manifest with missing tags array", () => {
    const filePath = writeTmpFile(
      "no-tags.json",
      JSON.stringify({
        version: 1,
        templateId: "test",
        templateName: "Test",
      }),
    );

    const result = loadManifest(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field === "tags")).toBe(true);

    unlinkSync(filePath);
  });

  it("validates individual tags in the array", () => {
    const filePath = writeTmpFile(
      "bad-tags.json",
      JSON.stringify({
        version: 1,
        templateId: "test",
        templateName: "Test",
        tags: [{ name: "Good Tag", type: "html", triggerEvent: "all_pages" }, { invalid: true }],
      }),
    );

    const result = loadManifest(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.field.includes("tags[1]"))).toBe(true);

    unlinkSync(filePath);
  });

  it("rejects non-object input", () => {
    const filePath = writeTmpFile("array.json", JSON.stringify([1, 2, 3]));

    const result = loadManifest(filePath);
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain("JSON object");

    unlinkSync(filePath);
  });
});

describe("Template Manifest — Round-Trip", () => {
  const tmpDir = mkdtempSync(join(tmpdir(), "tagops-manifest-roundtrip-"));

  it("export → file → load produces identical data", () => {
    const original = exportTemplate("meta-pixel", { pixelId: "123456789012345" });
    const filePath = join(tmpDir, "roundtrip.json");

    writeFileSync(filePath, JSON.stringify(original, null, 2));

    const loaded = loadManifest(filePath);
    expect(loaded.valid).toBe(true);
    expect(loaded.manifest!.templateId).toBe(original.templateId);
    expect(loaded.manifest!.tags.length).toBe(original.tags.length);
    expect(loaded.manifest!.inputs).toEqual(original.inputs);

    for (let i = 0; i < original.tags.length; i++) {
      expect(loaded.manifest!.tags[i].name).toBe(original.tags[i].name);
      expect(loaded.manifest!.tags[i].type).toBe(original.tags[i].type);
      expect(loaded.manifest!.tags[i].triggerEvent).toBe(original.tags[i].triggerEvent);
    }

    unlinkSync(filePath);
  });

  it("exports multiple templates with unique content", () => {
    const meta = exportTemplate("meta-pixel", { pixelId: "123456789012345" });
    const tiktok = exportTemplate("tiktok-pixel", { pixelId: "CXXXXXXXXXXXXXXXXX" });

    expect(meta.templateId).not.toBe(tiktok.templateId);
    expect(meta.vendor).not.toBe(tiktok.vendor);
    expect(meta.tags[0].name).not.toBe(tiktok.tags[0].name);
  });
});
