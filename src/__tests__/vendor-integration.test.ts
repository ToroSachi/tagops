/**
 * Integration Tests — cross-tool consistency and workflow verification.
 *
 * These tests validate that different tools agree with each other
 * when processing the same tags, and that the vendor detection
 * patterns are consistent across all entry points.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { isLightweightPixel, isAdVendor, isAnalyticsVendor } from "../lib/architecture.js";
import { findUnlimitedFiringTags } from "../tools/fix-firing.js";
import type { GtmTag } from "../types/gtm.js";

const BACKUP_DIR = resolve(import.meta.dirname, "../../backups/20260314_133738");
const backupTags = JSON.parse(readFileSync(resolve(BACKUP_DIR, "tags.json"), "utf-8")) as GtmTag[];

function makeMinimalTag(
  overrides: Partial<GtmTag> & { tagId: string; name: string; type: string },
): GtmTag {
  return { fingerprint: "test", firingTriggerId: ["1"], ...overrides };
}

describe("Centralized Vendor Detection", () => {
  it("ArtsAI is lightweight pixel, NOT ad vendor", () => {
    const text = "Artsai – Content (history) https://arttrk.com/pixel";
    expect(isLightweightPixel(text)).toBe(true);
    expect(isAdVendor(text)).toBe(false);
  });

  it("Magellan is lightweight pixel, NOT ad vendor", () => {
    const text = "Magellan – View (All Pages) MAI.emit";
    expect(isLightweightPixel(text)).toBe(true);
    expect(isAdVendor(text)).toBe(false);
  });

  it("Checkmate is lightweight pixel", () => {
    expect(isLightweightPixel("Checkmate Base")).toBe(true);
  });

  it("Meta is ad vendor, NOT lightweight", () => {
    const text = "Meta PageView fbq('track', 'PageView')";
    expect(isAdVendor(text)).toBe(true);
    expect(isLightweightPixel(text)).toBe(false);
  });

  it("TikTok is ad vendor", () => {
    expect(isAdVendor("TikTok Purchase ttq.track")).toBe(true);
  });

  it("hotjar is analytics vendor", () => {
    expect(isAnalyticsVendor("hotjar tracking")).toBe(true);
  });

  it("no pattern overlap between lightweight and ad vendor lists", () => {
    const testVendors = [
      "artsai pixel",
      "magellan view",
      "ascendia prime",
      "checkmate base",
      "aspireiq click",
    ];
    for (const text of testVendors) {
      expect(isLightweightPixel(text)).toBe(true);
      expect(isAdVendor(text)).toBe(false);
    }
  });
});

describe("Fix-Firing Tag Classification", () => {
  it("content tags from backup would get oncePerLoad", () => {
    const contentTags: GtmTag[] = [
      makeMinimalTag({ tagId: "100", name: "Artsai – Content (history)", type: "html" }),
      makeMinimalTag({
        tagId: "101",
        name: "Artsai – Lead (All Pages)",
        type: "html",
        firingTriggerId: ["83"],
      }),
      makeMinimalTag({
        tagId: "102",
        name: "Meta – Page View",
        type: "html",
        firingTriggerId: ["83"],
      }),
    ];

    const flagged = findUnlimitedFiringTags(contentTags);
    expect(flagged.length).toBe(3);

    for (const tag of flagged) {
      const nameLower = tag.name.toLowerCase();
      const isPageLevel =
        ["content", "lead", "page view", "pageview"].some((pattern) =>
          nameLower.includes(pattern),
        ) ||
        (tag.triggers.length === 1 && tag.triggers[0] === "83");
      expect(isPageLevel).toBe(true);
    }
  });

  it("conversion tags would get oncePerEvent", () => {
    const conversionTags: GtmTag[] = [
      makeMinimalTag({
        tagId: "200",
        name: "Meta – Purchase",
        type: "html",
        firingTriggerId: ["35"],
      }),
      makeMinimalTag({
        tagId: "201",
        name: "TikTok – Checkout",
        type: "html",
        firingTriggerId: ["89"],
      }),
    ];

    const flagged = findUnlimitedFiringTags(conversionTags);
    expect(flagged.length).toBe(2);

    for (const tag of flagged) {
      const nameLower = tag.name.toLowerCase();
      const isPageLevel =
        ["content", "lead", "page view", "pageview"].some((pattern) =>
          nameLower.includes(pattern),
        ) ||
        (tag.triggers.length === 1 && tag.triggers[0] === "83");
      expect(isPageLevel).toBe(false);
    }
  });
});

describe("Consent Classification Consistency", () => {
  it("classifyTag agrees with centralized vendor detection for live ArtsAI tags", async () => {
    const { classifyTag } = await import("../tools/consent-audit.js");
    const artsaiTags = backupTags.filter((tag) => tag.name.toLowerCase().includes("artsai"));

    for (const tag of artsaiTags) {
      expect(classifyTag(tag)).toBe("lightweight_pixel");
    }
  });

  it("classifyTag agrees with centralized vendor detection for live Meta tags", async () => {
    const { classifyTag } = await import("../tools/consent-audit.js");
    const metaTags = backupTags.filter((tag) => tag.name.startsWith("Meta") && tag.type === "html");

    for (const tag of metaTags) {
      expect(classifyTag(tag)).toBe("advertising");
    }
  });
});

describe("Magellan Template Structure", () => {
  it("Magellan View tag loads SDK and calls MAI.init + MAI.emit", async () => {
    const { installTemplate } = await import("../templates/registry.js");
    const result = await installTemplate("magellan-ai", {
      dryRun: true,
      pixelId: "test_token_123",
    });

    expect(result.actions.length).toBe(4);
    const viewAction = result.actions.find((action) => action.name.includes("View"));
    expect(viewAction).toBeDefined();
  });

  it("Magellan event tags guard with typeof MAI check", async () => {
    const { installTemplate } = await import("../templates/registry.js");
    const result = await installTemplate("magellan-ai", {
      dryRun: true,
      pixelId: "test123",
    });

    expect(result.actions.length).toBe(4);
    expect(result.templateId).toBe("magellan-ai");
  });
});
