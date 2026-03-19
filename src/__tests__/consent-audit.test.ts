/**
 * Tests for Consent Mode v2 Deep Auditor
 */

import { describe, it, expect } from "vitest";
import type { GtmTag } from "../types/gtm.js";

// We test the pure classification and audit functions directly
// by importing from the source (no mocking needed for pure logic)

describe("Consent Mode v2 Auditor", () => {
  // Helper to create a minimal tag
  function makeTag(
    overrides: Partial<GtmTag> & { tagId: string; name: string; type: string; fingerprint: string },
  ): GtmTag {
    return { firingTriggerId: ["1"], ...overrides };
  }

  describe("classifyTag", () => {
    it("classifies Google Ads conversion tags as advertising", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({ tagId: "1", name: "Ads Conversion", type: "awct", fingerprint: "a" });
      expect(classifyTag(tag)).toBe("advertising");
    });

    it("classifies GA4 configuration tags as analytics", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({ tagId: "2", name: "GA4 Config", type: "gaawc", fingerprint: "b" });
      expect(classifyTag(tag)).toBe("analytics");
    });

    it("classifies GA4 event tags as analytics", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({ tagId: "3", name: "GA4 Purchase", type: "gaawe", fingerprint: "c" });
      expect(classifyTag(tag)).toBe("analytics");
    });

    it("classifies googtag as analytics", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({ tagId: "4", name: "Google Tag", type: "googtag", fingerprint: "d" });
      expect(classifyTag(tag)).toBe("analytics");
    });

    it("classifies custom HTML with Meta pixel code as advertising", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({
        tagId: "5",
        name: "Meta PageView",
        type: "html",
        fingerprint: "e",
        parameter: [
          { type: "template", key: "html", value: "<script>fbq('track', 'PageView');</script>" },
        ],
      });
      expect(classifyTag(tag)).toBe("advertising");
    });

    it("classifies custom HTML with TikTok pixel as advertising", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({
        tagId: "6",
        name: "TikTok Purchase",
        type: "html",
        fingerprint: "f",
        parameter: [
          { type: "template", key: "html", value: "<script>ttq.track('CompletePayment')</script>" },
        ],
      });
      expect(classifyTag(tag)).toBe("advertising");
    });

    it("classifies plain custom HTML as custom_html", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({
        tagId: "7",
        name: "Custom Script",
        type: "html",
        fingerprint: "g",
        parameter: [
          { type: "template", key: "html", value: "<script>console.log('hello')</script>" },
        ],
      });
      expect(classifyTag(tag)).toBe("custom_html");
    });

    it("classifies Optimize tag as functional", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({ tagId: "8", name: "Optimize", type: "ogt", fingerprint: "h" });
      expect(classifyTag(tag)).toBe("functional");
    });

    it("classifies unknown tag types as unknown", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({ tagId: "9", name: "Mystery", type: "xyz_custom", fingerprint: "i" });
      expect(classifyTag(tag)).toBe("unknown");
    });

    it("classifies ArtsAI custom HTML as lightweight_pixel", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({
        tagId: "40",
        name: "Artsai – Content (history)",
        type: "html",
        fingerprint: "lp1",
        parameter: [
          {
            type: "template",
            key: "html",
            value: `<img src="https://arttrk.com/pixel/?action=content&pixid=test">`,
          },
        ],
      });
      expect(classifyTag(tag)).toBe("lightweight_pixel");
    });

    it("classifies Magellan custom HTML as lightweight_pixel", async () => {
      const { classifyTag } = await import("../tools/consent-audit.js");
      const tag = makeTag({
        tagId: "41",
        name: "Magellan – View",
        type: "html",
        fingerprint: "lp2",
        parameter: [
          { type: "template", key: "html", value: `<script>MAI.emit('pageview')</script>` },
        ],
      });
      expect(classifyTag(tag)).toBe("lightweight_pixel");
    });
  });

  describe("auditTagConsent", () => {
    it("marks advertising tag with all signals as compliant", async () => {
      const { auditTagConsent } = await import("../tools/consent-audit.js");
      const tag = makeTag({
        tagId: "10",
        name: "Ads Tag",
        type: "awct",
        fingerprint: "j",
        consentSettings: {
          consentStatus: "needed",
          consentType: {
            type: "list",
            list: [
              { type: "template", value: "ad_storage" },
              { type: "template", value: "ad_user_data" },
              { type: "template", value: "ad_personalization" },
            ],
          },
        },
      });
      const result = auditTagConsent(tag);
      expect(result.consentStatus).toBe("compliant");
      expect(result.category).toBe("advertising");
    });

    it("marks advertising tag missing ad_user_data as partial", async () => {
      const { auditTagConsent } = await import("../tools/consent-audit.js");
      const tag = makeTag({
        tagId: "11",
        name: "Ads Tag",
        type: "awct",
        fingerprint: "k",
        consentSettings: {
          consentStatus: "needed",
          consentType: {
            type: "list",
            list: [{ type: "template", value: "ad_storage" }],
          },
        },
      });
      const result = auditTagConsent(tag);
      expect(result.consentStatus).toBe("partial");
      expect(result.recommendation).toContain("ad_user_data");
    });

    it("marks tag with no consent configured as not_configured", async () => {
      const { auditTagConsent } = await import("../tools/consent-audit.js");
      const tag = makeTag({ tagId: "12", name: "Ads Tag", type: "awct", fingerprint: "l" });
      const result = auditTagConsent(tag);
      expect(result.consentStatus).toBe("not_configured");
      expect(result.recommendation).toBeDefined();
    });

    it("marks analytics tag with analytics_storage as compliant", async () => {
      const { auditTagConsent } = await import("../tools/consent-audit.js");
      const tag = makeTag({
        tagId: "13",
        name: "GA4",
        type: "gaawc",
        fingerprint: "m",
        consentSettings: {
          consentStatus: "needed",
          consentType: {
            type: "list",
            list: [{ type: "template", value: "analytics_storage" }],
          },
        },
      });
      const result = auditTagConsent(tag);
      expect(result.consentStatus).toBe("compliant");
    });

    it("marks functional tags as always compliant", async () => {
      const { auditTagConsent } = await import("../tools/consent-audit.js");
      const tag = makeTag({ tagId: "14", name: "Optimize", type: "ogt", fingerprint: "n" });
      const result = auditTagConsent(tag);
      expect(result.consentStatus).toBe("compliant");
      expect(result.signals).toHaveLength(0);
    });
  });

  describe("Compliance Score", () => {
    it("calculates 100% when all tags are compliant", async () => {
      const { auditTagConsent } = await import("../tools/consent-audit.js");
      const tags = [
        makeTag({
          tagId: "20",
          name: "GA4",
          type: "gaawc",
          fingerprint: "x",
          consentSettings: {
            consentStatus: "needed",
            consentType: { type: "list", list: [{ type: "template", value: "analytics_storage" }] },
          },
        }),
        makeTag({
          tagId: "21",
          name: "Ads",
          type: "awct",
          fingerprint: "y",
          consentSettings: {
            consentStatus: "needed",
            consentType: {
              type: "list",
              list: [
                { type: "template", value: "ad_storage" },
                { type: "template", value: "ad_user_data" },
                { type: "template", value: "ad_personalization" },
              ],
            },
          },
        }),
      ];

      const audits = tags.map(auditTagConsent);
      const compliant = audits.filter((a) => a.consentStatus === "compliant").length;
      expect(compliant).toBe(2);
    });

    it("calculates 0% when no tags have consent", async () => {
      const { auditTagConsent } = await import("../tools/consent-audit.js");
      const tags = [
        makeTag({ tagId: "30", name: "GA4", type: "gaawc", fingerprint: "z1" }),
        makeTag({ tagId: "31", name: "Ads", type: "awct", fingerprint: "z2" }),
      ];

      const audits = tags.map(auditTagConsent);
      const compliant = audits.filter((a) => a.consentStatus === "compliant").length;
      expect(compliant).toBe(0);
    });
  });
});
