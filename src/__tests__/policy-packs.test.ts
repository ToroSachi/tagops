/**
 * Tests for preset policy packs
 */
import { describe, it, expect } from "vitest";
import {
  getPolicyPack,
  listPolicyPacks,
  isPolicyPackName,
  POLICY_PACK_NAMES,
  type PolicyPackName,
} from "../lib/policy-packs.js";

describe("Policy Packs", () => {
  describe("listPolicyPacks", () => {
    it("returns all three preset packs", () => {
      const packs = listPolicyPacks();
      expect(packs).toHaveLength(3);
      const names = packs.map((p) => p.name);
      expect(names).toContain("gdpr-strict");
      expect(names).toContain("ccpa-baseline");
      expect(names).toContain("agency-standard");
    });

    it("every pack has title, description, and config", () => {
      for (const pack of listPolicyPacks()) {
        expect(pack.title).toBeTruthy();
        expect(pack.description).toBeTruthy();
        expect(pack.config).toBeTruthy();
        expect(pack.config.enabledPolicies).toBeDefined();
        expect(pack.config.enabledPolicies!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getPolicyPack", () => {
    it("returns the correct pack by name", () => {
      const gdpr = getPolicyPack("gdpr-strict");
      expect(gdpr.name).toBe("gdpr-strict");
      expect(gdpr.title).toContain("GDPR");
    });

    it("throws for unknown pack name", () => {
      expect(() => getPolicyPack("nonexistent" as PolicyPackName)).toThrow(/Unknown policy pack/);
    });
  });

  describe("isPolicyPackName", () => {
    it("returns true for valid names", () => {
      expect(isPolicyPackName("gdpr-strict")).toBe(true);
      expect(isPolicyPackName("ccpa-baseline")).toBe(true);
      expect(isPolicyPackName("agency-standard")).toBe(true);
    });

    it("returns false for invalid names", () => {
      expect(isPolicyPackName("invalid")).toBe(false);
      expect(isPolicyPackName("")).toBe(false);
      expect(isPolicyPackName("GDPR-STRICT")).toBe(false);
    });
  });

  describe("GDPR Strict pack", () => {
    const pack = getPolicyPack("gdpr-strict");

    it("requires consent-v2-advertising and analytics policies", () => {
      expect(pack.config.enabledPolicies).toContain("consent-v2-advertising");
      expect(pack.config.enabledPolicies).toContain("consent-v2-analytics");
    });

    it("includes vendor consent matrix with ad_user_data for Meta", () => {
      expect(pack.config.vendorConsentMatrix?.Meta).toContain("ad_storage");
      expect(pack.config.vendorConsentMatrix?.Meta).toContain("ad_user_data");
    });

    it("requires ad_personalization for Google Ads", () => {
      expect(pack.config.vendorConsentMatrix?.["Google Ads"]).toContain("ad_personalization");
    });

    it("includes custom policies for PII and consent init", () => {
      expect(pack.config.customPolicies).toBeDefined();
      expect(pack.config.customPolicies!.length).toBeGreaterThan(0);
      const policyIds = pack.config.customPolicies!.map((p) => p.id);
      expect(policyIds).toContain("gdpr-no-pii-in-html");
      expect(policyIds).toContain("gdpr-consent-init-required");
    });

    it("enforces naming conventions", () => {
      expect(pack.config.naming).toBeDefined();
    });
  });

  describe("CCPA Baseline pack", () => {
    const pack = getPolicyPack("ccpa-baseline");

    it("is lighter than GDPR — no ad_user_data requirement", () => {
      expect(pack.config.vendorConsentMatrix?.Meta).toEqual(["ad_storage"]);
    });

    it("requires analytics_storage for GA4", () => {
      expect(pack.config.vendorConsentMatrix?.GA4).toEqual(["analytics_storage"]);
    });

    it("does not include custom policies by default", () => {
      expect(pack.config.customPolicies).toBeUndefined();
    });
  });

  describe("Agency Standard pack", () => {
    const pack = getPolicyPack("agency-standard");

    it("includes full governance policies", () => {
      expect(pack.config.enabledPolicies).toContain("naming-convention");
      expect(pack.config.enabledPolicies).toContain("no-orphaned-triggers");
      expect(pack.config.enabledPolicies).toContain("meta-dedup");
    });

    it("includes naming patterns", () => {
      expect(pack.config.naming?.tagPattern).toBeTruthy();
      expect(pack.config.naming?.triggerPattern).toBeTruthy();
    });

    it("has custom policy for performance-sensitive HTML tags", () => {
      expect(pack.config.customPolicies).toBeDefined();
      const ids = pack.config.customPolicies!.map((p) => p.id);
      expect(ids).toContain("agency-no-all-pages-html");
    });
  });

  describe("POLICY_PACK_NAMES constant", () => {
    it("matches the registered pack names", () => {
      const registeredNames = listPolicyPacks().map((p) => p.name);
      expect(POLICY_PACK_NAMES).toEqual(registeredNames);
    });
  });
});
