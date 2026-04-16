/**
 * Preset Policy Packs
 *
 * Ready-to-use compliance policy configurations that ship with TagOps.
 * Users can install these with `tagops init --policies <pack>` instead
 * of writing `.tagops-policies.json` from scratch.
 *
 * Available packs:
 *   gdpr-strict   — Full GDPR Consent Mode v2 compliance
 *   ccpa-baseline — CCPA / US State Privacy compliance
 *   agency-standard — Agency-level governance baseline
 */

import type { PolicyFileConfig } from "./policies.js";

export type PolicyPackName = "gdpr-strict" | "ccpa-baseline" | "agency-standard";

export const POLICY_PACK_NAMES: PolicyPackName[] = [
  "gdpr-strict",
  "ccpa-baseline",
  "agency-standard",
];

export interface PolicyPackMeta {
  name: PolicyPackName;
  title: string;
  description: string;
  config: PolicyFileConfig;
}

// ── GDPR Strict ──
// Full Consent Mode v2 compliance for EU traffic.
// All advertising and analytics tags require explicit consent signals.
// No document.write, no inline PII patterns, Meta dedup required.

const GDPR_STRICT: PolicyPackMeta = {
  name: "gdpr-strict",
  title: "GDPR Strict (Consent Mode v2)",
  description:
    "Full EU compliance. Requires consent on all tags, blocks document.write, enforces Meta event dedup, and applies the vendor-consent matrix.",
  config: {
    enabledPolicies: [
      "consent-v2-advertising",
      "consent-v2-analytics",
      "no-document-write",
      "meta-dedup",
      "vendor-consent-matrix",
      "naming-convention",
      "no-orphaned-triggers",
      "spa-firing-safety",
    ],
    naming: {
      tagPrefix: ["GA4 -", "Meta -", "Google Ads -", "TikTok -", "LinkedIn -"],
      triggerPrefix: ["CE -", "PV -", "Click -", "Timer -", "Scroll -"],
    },
    vendorConsentMatrix: {
      Meta: ["ad_storage", "ad_user_data"],
      GA4: ["analytics_storage"],
      "Google Analytics": ["analytics_storage"],
      "Google Ads": ["ad_storage", "ad_user_data", "ad_personalization"],
      TikTok: ["ad_storage", "ad_user_data"],
      Pinterest: ["ad_storage"],
      Reddit: ["ad_storage"],
      LinkedIn: ["ad_storage", "ad_user_data"],
      Snapchat: ["ad_storage"],
      Taboola: ["ad_storage"],
      Outbrain: ["ad_storage"],
      Criteo: ["ad_storage", "ad_user_data"],
    },
    customPolicies: [
      {
        id: "gdpr-no-pii-in-html",
        name: "No PII Patterns in Custom HTML",
        description:
          "Custom HTML tags must not contain patterns that indicate hardcoded PII (email, phone).",
        severity: "error",
        category: "security",
        target: "tag",
        match: {
          typeIn: "html",
        },
        require: {
          noDocumentWrite: true,
        },
      },
      {
        id: "gdpr-consent-init-required",
        name: "Consent Initialization Required",
        description:
          "At least one tag must fire on the Consent Initialization trigger to set default consent state.",
        severity: "warning",
        category: "consent",
        target: "tag",
        match: {
          nameIncludes: ["consent", "cmp", "cookie"],
        },
        require: {
          consentSignals: ["analytics_storage"],
        },
      },
    ],
  },
};

// ── CCPA Baseline ──
// Minimum US State Privacy compliance.
// Advertising tags require ad_storage consent.
// Analytics tags require analytics_storage.
// Lighter than GDPR — no ad_user_data / ad_personalization requirements.

const CCPA_BASELINE: PolicyPackMeta = {
  name: "ccpa-baseline",
  title: "CCPA / US State Privacy Baseline",
  description:
    "Minimum US privacy compliance. Requires ad_storage on advertising tags, analytics_storage on analytics tags. No document.write.",
  config: {
    enabledPolicies: [
      "consent-v2-advertising",
      "consent-v2-analytics",
      "no-document-write",
      "no-orphaned-triggers",
    ],
    vendorConsentMatrix: {
      Meta: ["ad_storage"],
      GA4: ["analytics_storage"],
      "Google Analytics": ["analytics_storage"],
      "Google Ads": ["ad_storage"],
      TikTok: ["ad_storage"],
      Pinterest: ["ad_storage"],
      Reddit: ["ad_storage"],
      LinkedIn: ["ad_storage"],
      Snapchat: ["ad_storage"],
    },
  },
};

// ── Agency Standard ──
// Agency governance baseline for multi-client management.
// Enforces naming conventions, dedup, consent signals, and orphan cleanup.
// Designed for agencies managing 10+ GTM containers with shared standards.

const AGENCY_STANDARD: PolicyPackMeta = {
  name: "agency-standard",
  title: "Agency Governance Standard",
  description:
    "Full governance baseline: naming conventions, consent signals, Meta dedup, orphan trigger cleanup, SPA firing safety.",
  config: {
    enabledPolicies: [
      "consent-v2-advertising",
      "consent-v2-analytics",
      "spa-firing-safety",
      "no-document-write",
      "meta-dedup",
      "naming-convention",
      "no-orphaned-triggers",
      "vendor-consent-matrix",
    ],
    naming: {
      tagPattern: "^[A-Za-z0-9][A-Za-z0-9 ]*\\s[–-]\\s",
      triggerPattern: "^(CE|PV|Click|Timer|Scroll|Exception|Form|History)\\s[–-]\\s",
    },
    vendorConsentMatrix: {
      Meta: ["ad_storage"],
      GA4: ["analytics_storage"],
      "Google Analytics": ["analytics_storage"],
      "Google Ads": ["ad_storage", "ad_user_data"],
      TikTok: ["ad_storage"],
      Pinterest: ["ad_storage"],
      Reddit: ["ad_storage"],
      LinkedIn: ["ad_storage"],
      Snapchat: ["ad_storage"],
      Taboola: ["ad_storage"],
    },
    customPolicies: [
      {
        id: "agency-no-all-pages-html",
        name: "No Custom HTML on All Pages Without Review",
        description:
          "Custom HTML tags firing on All Pages should be reviewed — they impact every page load.",
        severity: "warning",
        category: "performance",
        target: "tag",
        match: {
          typeIn: "html",
          firingTriggerTypes: "PAGEVIEW",
        },
        require: {
          noDocumentWrite: true,
        },
      },
    ],
  },
};

// ── Registry ──

const POLICY_PACKS: Record<PolicyPackName, PolicyPackMeta> = {
  "gdpr-strict": GDPR_STRICT,
  "ccpa-baseline": CCPA_BASELINE,
  "agency-standard": AGENCY_STANDARD,
};

export function getPolicyPack(name: PolicyPackName): PolicyPackMeta {
  const pack = POLICY_PACKS[name];
  if (!pack) {
    const available = Object.keys(POLICY_PACKS).join(", ");
    throw new Error(`Unknown policy pack "${name}". Available: ${available}`);
  }
  return pack;
}

export function listPolicyPacks(): PolicyPackMeta[] {
  return Object.values(POLICY_PACKS);
}

export function isPolicyPackName(value: string): value is PolicyPackName {
  return POLICY_PACK_NAMES.includes(value as PolicyPackName);
}
