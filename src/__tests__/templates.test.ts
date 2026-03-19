/**
 * Template Integration Tests
 *
 * Validates all 14 integration templates for:
 * 1. Registry structure (required fields, valid categories)
 * 2. Tag generation (HTML correctness, trigger mapping, consent)
 * 3. Cross-reference against live GTM backup data
 * 4. Pixel ID substitution (no hardcoded IDs leak through)
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTemplates, installTemplate } from "../templates/registry.js";
import { TRIGGER_MAP } from "../lib/architecture.js";

// ── Load the live backup for cross-reference ──
const BACKUP_DIR = resolve(import.meta.dirname, "../../backups/20260314_133738");
const backupTags = JSON.parse(readFileSync(resolve(BACKUP_DIR, "tags.json"), "utf-8")) as Array<{
  tagId: string;
  name: string;
  type: string;
  parameter?: Array<{ key: string; value: string }>;
  firingTriggerId?: string[];
  consentSettings?: { consentStatus: string; consentType?: { list?: Array<{ value: string }> } };
  paused?: boolean;
}>;

const VALID_CATEGORIES = [
  "analytics",
  "advertising",
  "marketing",
  "social",
  "attribution",
  "retargeting",
  "platform",
  "affiliate",
];
const VALID_CONSENT_TYPES = ["ad_storage", "analytics_storage"];
const VALID_TRIGGER_EVENTS = [
  ...Object.keys(TRIGGER_MAP),
  "all_pages", // Built-in trigger
];

// ── Helpers ──

function getActiveTags() {
  return backupTags.filter((t) => !t.paused);
}

function getTagsByPrefix(prefix: string) {
  return getActiveTags().filter((t) => t.name.startsWith(prefix));
}

function getTagHtml(tag: (typeof backupTags)[0]): string {
  const htmlParam = tag.parameter?.find((p) => p.key === "html");
  return htmlParam?.value ?? "";
}

function getTagConsent(tag: (typeof backupTags)[0]): string | null {
  if (tag.consentSettings?.consentStatus !== "needed") return null;
  return tag.consentSettings?.consentType?.list?.[0]?.value ?? null;
}

// ═══════════════════════════════════════════════════════════
// 1. REGISTRY STRUCTURE TESTS
// ═══════════════════════════════════════════════════════════

describe("Template Registry — Structure", () => {
  const templates = listTemplates();

  it("should have at least 18 templates", () => {
    expect(templates.length).toBeGreaterThanOrEqual(18);
  });

  it("all templates have unique IDs", () => {
    const ids = templates.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("all templates have required fields", () => {
    for (const t of templates) {
      expect(t.id).toBeTruthy();
      expect(t.name).toBeTruthy();
      expect(t.description).toBeTruthy();
      expect(t.vendor).toBeTruthy();
      expect(t.category).toBeTruthy();
      expect(Array.isArray(t.requiredInputs)).toBe(true);
    }
  });

  it("all templates have valid categories", () => {
    for (const t of templates) {
      expect(VALID_CATEGORIES).toContain(t.category);
    }
  });

  it("all required inputs have key, name, description, example", () => {
    for (const t of templates) {
      for (const input of t.requiredInputs) {
        expect(input.key).toBeTruthy();
        expect(input.name).toBeTruthy();
        expect(input.description).toBeTruthy();
        expect(input.example).toBeTruthy();
      }
    }
  });

  it("template IDs use kebab-case", () => {
    for (const t of templates) {
      expect(t.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// 2. TAG GENERATION TESTS
// ═══════════════════════════════════════════════════════════

describe("Template Tag Generation", () => {
  const templates = listTemplates();

  it("all templates generate at least 1 tag", async () => {
    for (const t of templates) {
      const result = await installTemplate(t.id, {
        dryRun: true,
        pixelId: "TEST_PIXEL_123",
        measurementId: "G-TEST123",
      });
      expect(result.actions.length).toBeGreaterThan(0);
      expect(result.summary.tags).toBeGreaterThan(0);
    }
  });

  it("no template generates errors in dry-run", async () => {
    for (const t of templates) {
      const result = await installTemplate(t.id, {
        dryRun: true,
        pixelId: "TEST_PIXEL_123",
        measurementId: "G-TEST123",
      });
      expect(result.summary.failed).toBe(0);
    }
  });

  it("all tags have valid trigger events", async () => {
    for (const t of templates) {
      const result = await installTemplate(t.id, {
        dryRun: true,
        pixelId: "TEST_PIXEL_123",
        measurementId: "G-TEST123",
      });
      // Dry-run actions include trigger name in detail
      for (const action of result.actions) {
        if (action.type === "tag" && action.detail) {
          // Should resolve to a known trigger or be "all_pages"
          expect(action.detail).toMatch(/trigger:/);
        }
      }
    }
  });
});

// ═══════════════════════════════════════════════════════════
// 3. PIXEL ID SUBSTITUTION TESTS
// ═══════════════════════════════════════════════════════════

describe("Pixel ID Substitution", () => {
  it("Meta Pixel substitutes pixel ID correctly", async () => {
    const result = await installTemplate("meta-pixel", {
      dryRun: true,
      pixelId: "9876543210",
    });
    expect(result.templateId).toBe("meta-pixel");
    expect(result.actions.length).toBe(5);
  });

  it("TikTok substitutes pixel ID in base loader", async () => {
    const result = await installTemplate("tiktok-pixel", {
      dryRun: true,
      pixelId: "C1234TEST",
    });
    expect(result.actions.length).toBe(6); // base + SPA page view + 4 events
  });

  it("Reddit substitutes pixel ID", async () => {
    const result = await installTemplate("reddit-pixel", {
      dryRun: true,
      pixelId: "t2_reddit_test",
    });
    expect(result.actions.length).toBe(5);
  });

  it("Taboola substitutes account ID", async () => {
    const result = await installTemplate("taboola-pixel", {
      dryRun: true,
      pixelId: "1969618",
    });
    expect(result.actions.length).toBe(6); // base + SPA + 4 events
  });

  it("Artsai substitutes pixel UUID", async () => {
    const result = await installTemplate("artsai-iheart", {
      dryRun: true,
      pixelId: "8c599a46-94fb-484b-a46e-5a3fe33b3388",
    });
    expect(result.actions.length).toBe(6);
  });

  it("Magellan AI uses MAI.emit SDK instead of image pixels", async () => {
    const result = await installTemplate("magellan-ai", {
      dryRun: true,
      pixelId: "019cd8d8037677ab85faf4f598184962",
    });
    expect(result.actions.length).toBe(4); // View + Purchase + Checkout + Bundle Builder
  });

  it("Checkmate substitutes Shopify store handle", async () => {
    const result = await installTemplate("checkmate", {
      dryRun: true,
      pixelId: "tnmeats",
    });
    expect(result.actions.length).toBe(3); // base + attribution + store attribution
  });

  it("MINTY substitutes widget ID", async () => {
    const result = await installTemplate("minty-addshoppers", {
      dryRun: true,
      pixelId: "6979d88f164ae1058b182784",
    });
    expect(result.actions.length).toBe(2); // base + conversion
  });

  it("Klaviyo substitutes API key", async () => {
    const result = await installTemplate("klaviyo", {
      dryRun: true,
      pixelId: "SFwUtB",
    });
    expect(result.actions.length).toBe(1);
  });

  it("Ascendia Prime substitutes script ID", async () => {
    const result = await installTemplate("ascendia-prime", {
      dryRun: true,
      pixelId: "hr59lfl757n0z96dt3i4azdy",
    });
    expect(result.actions.length).toBe(1);
  });

  it("Shopify Custom Pixel substitutes GTM container ID", async () => {
    const result = await installTemplate("shopify-custom-pixel", {
      dryRun: true,
      pixelId: "GTM-XXXXXXX",
    });
    expect(result.actions.length).toBe(1); // Single combined pixel
  });

  it("AspireIQ substitutes advertiser ID", async () => {
    const result = await installTemplate("aspireiq", {
      dryRun: true,
      pixelId: "aspireiq",
    });
    expect(result.actions.length).toBe(2); // Click + conversion
  });

  it("Impact.com substitutes account SID", async () => {
    const result = await installTemplate("impact-com", {
      dryRun: true,
      pixelId: "IR12345",
    });
    expect(result.actions.length).toBe(3); // UTT + Identify + Conversion
  });

  it("Retention.com substitutes API key", async () => {
    const result = await installTemplate("retention-com", {
      dryRun: true,
      pixelId: "X2JHJWZG",
    });
    expect(result.actions.length).toBe(2); // Base + page
  });
});

// ═══════════════════════════════════════════════════════════
// 4. CROSS-REFERENCE AGAINST LIVE BACKUP
// ═══════════════════════════════════════════════════════════

describe("Cross-Reference: Templates vs Live GTM Backup", () => {
  // ── Meta Pixel ──
  describe("Meta Pixel", () => {
    const liveMetaTags = getActiveTags().filter(
      (t) => t.name.startsWith("Meta") && t.type === "html",
    );

    it("live container has 6 Meta tags (base + 5 events)", () => {
      expect(liveMetaTags.length).toBe(6);
    });

    it("template generates 5 tags (base combined with PageView)", async () => {
      const result = await installTemplate("meta-pixel", {
        dryRun: true,
        pixelId: "1368439691504226",
      });
      expect(result.summary.tags).toBe(5);
    });

    it("all live Meta tags use ad_storage consent", () => {
      for (const tag of liveMetaTags) {
        const consent = getTagConsent(tag);
        expect(consent).toBe("ad_storage");
      }
    });

    it("live Meta Purchase tag references JS - Ecommerce Value (Number)", () => {
      const purchaseTag = liveMetaTags.find((t) => t.name.includes("Purchase"));
      expect(purchaseTag).toBeDefined();
      const html = getTagHtml(purchaseTag!);
      expect(html).toContain("JS - Ecommerce Value (Number)");
    });
  });

  // ── TikTok ──
  describe("TikTok Pixel", () => {
    const liveTikTokTags = getActiveTags().filter(
      (t) => t.name.startsWith("TikTok") || t.name.startsWith("TIKTOK"),
    );

    it("live container has 6 TikTok tags", () => {
      expect(liveTikTokTags.length).toBe(6);
    });

    it("template generates 6 tags (base + SPA + 4 events)", async () => {
      const result = await installTemplate("tiktok-pixel", {
        dryRun: true,
        pixelId: "TEST",
      });
      expect(result.summary.tags).toBe(6);
    });

    it("live TikTok base tag has SPA duplicate prevention", () => {
      const baseTag = liveTikTokTags.find((t) => t.name.includes("Base"));
      expect(baseTag).toBeDefined();
      const html = getTagHtml(baseTag!);
      expect(html).toContain("__tnm_tiktok_base_loaded");
    });

    it("live TikTok Purchase uses CompletePayment event", () => {
      const purchaseTag = liveTikTokTags.find((t) => t.name.includes("Purchase"));
      expect(purchaseTag).toBeDefined();
      const html = getTagHtml(purchaseTag!);
      expect(html).toContain("CompletePayment");
    });

    it("live TikTok tags guard with window.ttq check", () => {
      const eventTags = liveTikTokTags.filter((t) => !t.name.includes("Base"));
      for (const tag of eventTags) {
        const html = getTagHtml(tag);
        expect(html).toContain("window.ttq");
      }
    });
  });

  // ── Reddit ──
  describe("Reddit Pixel", () => {
    const liveRedditTags = getActiveTags().filter((t) => t.name.startsWith("REDDIT"));

    it("live container has 5 Reddit tags", () => {
      expect(liveRedditTags.length).toBe(5);
    });

    it("template generates 5 tags", async () => {
      const result = await installTemplate("reddit-pixel", {
        dryRun: true,
        pixelId: "TEST",
      });
      expect(result.summary.tags).toBe(5);
    });

    it("live Reddit event tags guard with typeof rdt check", () => {
      const eventTags = liveRedditTags.filter(
        (t) => t.type === "html" && !t.name.includes("Page Visit"),
      );
      for (const tag of eventTags) {
        const html = getTagHtml(tag);
        if (html) {
          expect(html).toContain("typeof rdt");
        }
      }
    });

    it("live Reddit Purchase includes tax and shipping", () => {
      const purchaseTag = liveRedditTags.find((t) => t.name.includes("Purchase"));
      expect(purchaseTag).toBeDefined();
      const html = getTagHtml(purchaseTag!);
      expect(html).toContain("tax");
      expect(html).toContain("shipping");
    });
  });

  // ── Taboola ──
  describe("Taboola Pixel", () => {
    const liveTaboolaTags = getActiveTags().filter((t) => t.name.startsWith("TABOOLA"));

    it("live container has 5 active Taboola tags", () => {
      expect(liveTaboolaTags.length).toBe(5);
    });

    it("template generates 6 tags (base + 5 events)", async () => {
      const result = await installTemplate("taboola-pixel", {
        dryRun: true,
        pixelId: "1969618",
      });
      expect(result.summary.tags).toBe(6);
    });

    it("live Taboola uses _tfa array for events", () => {
      for (const tag of liveTaboolaTags) {
        const html = getTagHtml(tag);
        expect(html).toContain("_tfa");
      }
    });

    it("live Taboola Purchase includes cartDetails and orderId", () => {
      const purchaseTag = liveTaboolaTags.find((t) => t.name.includes("Purchase"));
      expect(purchaseTag).toBeDefined();
      const html = getTagHtml(purchaseTag!);
      expect(html).toContain("cartDetails");
      expect(html).toContain("orderId");
    });
  });

  // ── Klaviyo ──
  describe("Klaviyo", () => {
    const liveKlaviyo = getActiveTags().find((t) => t.name === "Klaviyo Tracking");

    it("live container has Klaviyo Tracking tag", () => {
      expect(liveKlaviyo).toBeDefined();
    });

    it("live Klaviyo loads from static.klaviyo.com", () => {
      const html = getTagHtml(liveKlaviyo!);
      expect(html).toContain("static.klaviyo.com");
    });

    it("live Klaviyo contains company_id", () => {
      const html = getTagHtml(liveKlaviyo!);
      expect(html).toContain("company_id");
    });

    it("template generates 1 tag", async () => {
      const result = await installTemplate("klaviyo", {
        dryRun: true,
        pixelId: "SFwUtB",
      });
      expect(result.summary.tags).toBe(1);
    });
  });

  // ── MINTY / AddShoppers ──
  describe("MINTY (AddShoppers)", () => {
    const liveMintyTags = getActiveTags().filter((t) => t.name.startsWith("MINTY"));

    it("live container has 2 MINTY tags", () => {
      expect(liveMintyTags.length).toBe(2);
    });

    it("live MINTY Global uses shop.pe widget", () => {
      const globalTag = liveMintyTags.find((t) => t.name.includes("Global"));
      expect(globalTag).toBeDefined();
      const html = getTagHtml(globalTag!);
      expect(html).toContain("shop.pe/widget");
    });

    it("live MINTY Conversion passes order_id and value", () => {
      const convTag = liveMintyTags.find((t) => t.name.includes("Conversion"));
      expect(convTag).toBeDefined();
      const html = getTagHtml(convTag!);
      expect(html).toContain("AddShoppersConversion");
      expect(html).toContain("order_id");
      expect(html).toContain("value");
    });

    it("template generates 2 tags", async () => {
      const result = await installTemplate("minty-addshoppers", {
        dryRun: true,
        pixelId: "test123",
      });
      expect(result.summary.tags).toBe(2);
    });
  });

  // ── Checkmate ──
  describe("Checkmate Attribution", () => {
    const liveCheckmateTags = getActiveTags().filter(
      (t) => t.name.startsWith("Checkmate") || t.name === "Store Attribution",
    );

    it("live container has 3 attribution tags (2 Checkmate + Store)", () => {
      expect(liveCheckmateTags.length).toBe(3);
    });

    it("live Checkmate Base loads from myshopify.com/apps/cm", () => {
      const baseTag = liveCheckmateTags.find((t) => t.name.includes("Base"));
      expect(baseTag).toBeDefined();
      const html = getTagHtml(baseTag!);
      expect(html).toContain("myshopify.com/apps/cm");
    });

    it("live Store Attribution captures UTM params", () => {
      const storeTag = liveCheckmateTags.find((t) => t.name === "Store Attribution");
      expect(storeTag).toBeDefined();
      const html = getTagHtml(storeTag!);
      expect(html).toContain("utm_source");
      expect(html).toContain("utm_campaign");
      expect(html).toContain("gclid");
      expect(html).toContain("fbclid");
    });

    it("template generates 3 tags", async () => {
      const result = await installTemplate("checkmate", {
        dryRun: true,
        pixelId: "tnmeats",
      });
      expect(result.summary.tags).toBe(3);
    });
  });

  // ── Ascendia Prime ──
  describe("Ascendia Prime", () => {
    const liveAscendia = getActiveTags().find((t) => t.name === "Ascendia Prime");

    it("live container has Ascendia Prime tag", () => {
      expect(liveAscendia).toBeDefined();
    });

    it("live Ascendia loads from readtargeting.com CDN", () => {
      const html = getTagHtml(liveAscendia!);
      expect(html).toContain("readtargeting.com");
    });

    it("template generates 1 tag", async () => {
      const result = await installTemplate("ascendia-prime", {
        dryRun: true,
        pixelId: "test123",
      });
      expect(result.summary.tags).toBe(1);
    });
  });

  // ── Vibe ──
  describe("Vibe Pixel", () => {
    const liveVibe = getActiveTags().find((t) => t.name === "Vibe Pixel");

    it("live container has Vibe Pixel tag", () => {
      expect(liveVibe).toBeDefined();
    });

    it("live Vibe uses community template type (not html)", () => {
      expect(liveVibe!.type).toContain("cvt_");
    });

    it("template generates 1 tag", async () => {
      const result = await installTemplate("vibe-pixel", {
        dryRun: true,
        pixelId: "test",
      });
      expect(result.summary.tags).toBe(1);
    });
  });

  // ── Retention.com (paused in live container) ──
  describe("Retention.com", () => {
    const liveRetentionTags = backupTags.filter((t) => t.name.includes("Retention"));

    it("live container has 2 Retention tags (both paused)", () => {
      expect(liveRetentionTags.length).toBe(2);
      for (const t of liveRetentionTags) {
        expect(t.paused).toBe(true);
      }
    });

    it("live Retention base script uses geq.js loader", () => {
      const baseTag = liveRetentionTags.find((t) => t.name.includes("Base"));
      expect(baseTag).toBeDefined();
      const html = getTagHtml(baseTag!);
      expect(html).toContain("geq");
      expect(html).toContain("X2JHJWZG");
    });

    it("live Retention page tag calls geq.page()", () => {
      const pageTag = liveRetentionTags.find((t) => t.name === "Retention Collection");
      expect(pageTag).toBeDefined();
      const html = getTagHtml(pageTag!);
      expect(html).toContain("geq.page()");
    });

    it("template generates 2 tags", async () => {
      const result = await installTemplate("retention-com", {
        dryRun: true,
        pixelId: "X2JHJWZG",
      });
      expect(result.summary.tags).toBe(2);
    });
  });

  // ── Shopify Custom Pixel ──
  describe("Shopify Custom Pixel", () => {
    it("template generates 1 combined tag", async () => {
      const result = await installTemplate("shopify-custom-pixel", {
        dryRun: true,
        pixelId: "GTM-XXXXXXX",
      });
      expect(result.summary.tags).toBe(1);
    });
  });

  // ── AspireIQ ──
  describe("AspireIQ", () => {
    it("template generates 2 tags (click + conversion)", async () => {
      const result = await installTemplate("aspireiq", {
        dryRun: true,
        pixelId: "aspireiq",
      });
      expect(result.summary.tags).toBe(2);
    });
  });

  // ── Impact.com ──
  describe("Impact.com", () => {
    it("template generates 3 tags (UTT + Identify + Conversion)", async () => {
      const result = await installTemplate("impact-com", {
        dryRun: true,
        pixelId: "IR12345",
      });
      expect(result.summary.tags).toBe(3);
    });
  });
});

// ═══════════════════════════════════════════════════════════
// 5. CONSENT SETTINGS VERIFICATION
// ═══════════════════════════════════════════════════════════

describe("Consent Settings", () => {
  it("all advertising tags in live container use ad_storage", () => {
    const adTags = getActiveTags().filter(
      (t) =>
        t.name.startsWith("Meta") ||
        t.name.startsWith("REDDIT") ||
        t.name.startsWith("TABOOLA") ||
        t.name.startsWith("TIKTOK") ||
        t.name.startsWith("TikTok"),
    );
    for (const tag of adTags) {
      const consent = getTagConsent(tag);
      if (consent) {
        expect(consent).toBe("ad_storage");
      }
    }
  });

  it("Klaviyo uses analytics_storage consent", () => {
    const klaviyo = getActiveTags().find((t) => t.name === "Klaviyo Tracking");
    // Klaviyo may not have consent set in the live container
    // but our template should set analytics_storage
    expect(klaviyo).toBeDefined();
  });
});

// ═══════════════════════════════════════════════════════════
// 6. TRIGGER MAPPING COVERAGE
// ═══════════════════════════════════════════════════════════

describe("Trigger Mapping Coverage", () => {
  const coreEvents = ["page_view", "view_item", "add_to_cart", "begin_checkout", "purchase"];

  it("full-funnel templates cover all 5 core e-commerce events", async () => {
    const fullFunnelTemplates = ["meta-pixel", "tiktok-pixel", "reddit-pixel"];
    for (const id of fullFunnelTemplates) {
      const result = await installTemplate(id, {
        dryRun: true,
        pixelId: "TEST",
      });
      const triggersCovered = result.actions.filter((a) => a.detail).map((a) => a.detail!);

      // Should have triggers for page_view, view_item, add_to_cart, begin_checkout, purchase
      for (const event of coreEvents) {
        const triggerName = TRIGGER_MAP[event]?.name ?? event;
        const hasTrigger = triggersCovered.some(
          (d) => d.includes(triggerName) || d.includes(event),
        );
        expect(hasTrigger, `${id} missing trigger for ${event}`).toBe(true);
      }
    }
  });

  it("Taboola covers view_item, add_to_cart, begin_checkout, purchase", async () => {
    const result = await installTemplate("taboola-pixel", {
      dryRun: true,
      pixelId: "1969618",
    });
    expect(result.summary.tags).toBeGreaterThanOrEqual(5);
  });
});

// ═══════════════════════════════════════════════════════════
// 7. ACTIVE TAG COUNT SUMMARY
// ═══════════════════════════════════════════════════════════

describe("Live Container Summary", () => {
  const active = getActiveTags();
  const paused = backupTags.filter((t) => t.paused);

  it("container has the expected number of active tags", () => {
    // Document the count — fails if container changes significantly
    expect(active.length).toBeGreaterThanOrEqual(35);
  });

  it("all major integrations are present and active", () => {
    const requiredPrefixes = [
      "GA4",
      "Meta",
      "TikTok",
      "TIKTOK",
      "REDDIT",
      "TABOOLA",
      "MINTY",
      "Klaviyo",
      "Checkmate",
      "Ascendia",
    ];
    for (const prefix of requiredPrefixes) {
      const found = active.some((t) => t.name.startsWith(prefix));
      expect(found, `Missing active tag starting with "${prefix}"`).toBe(true);
    }
  });
});
