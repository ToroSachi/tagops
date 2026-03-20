/**
 * Consent Mode v2 Deep Auditor
 *
 * Comprehensive audit of Google Consent Mode v2 compliance across all tags.
 * Google's July 2025 deadline requires all tags sending data to Google services
 * to properly declare consent signals: ad_storage, ad_user_data,
 * ad_personalization, and analytics_storage.
 *
 * This auditor:
 *   1. Classifies every tag by its data usage (advertising, analytics, etc.)
 *   2. Checks for all 4 consent signals based on classification
 *   3. Generates a compliance score (0-100%)
 *   4. Produces auto-fix recommendations
 *
 * Usage:
 *   tagops consent-audit
 *   tagops consent-audit --fix
 *   tagops consent-audit --score-only
 */

import chalk from "chalk";
import { buildCompleteTagConfig, getTag, listTags, updateTag } from "../lib/gtm-cli.js";
import {
  LIGHTWEIGHT_PIXEL_PATTERNS,
  AD_VENDOR_PATTERNS,
  ANALYTICS_VENDOR_PATTERNS,
} from "../lib/architecture.js";
import { createPreFixBackup } from "../lib/pre-fix-backup.js";
import { requireWriteAccess } from "../lib/permission-guard.js";
import type {
  GtmTag,
  TagDataCategory,
  ConsentSignalStatus,
  ConsentTagAudit,
  ConsentAuditReport,
} from "../types/gtm.js";

// ── Tag Classification Rules ──

/** Tag types that are Google Ads / advertising */
const ADVERTISING_TAG_TYPES = new Set([
  "awct", // Google Ads Conversion Tracking
  "sp", // Google Ads Remarketing
  "flc", // Floodlight Counter
  "fls", // Floodlight Sales
  "gclidw", // Google Conversion Linker
  "sar", // Google Ads Search Ads Remarketing
]);

/** Tag types that are Google Analytics */
const ANALYTICS_TAG_TYPES = new Set([
  "gaawc", // GA4 Configuration
  "gaawe", // GA4 Event
  "googtag", // Google Tag
  "ua", // Universal Analytics (legacy)
]);

/** Tag types that are functional / utility */
const FUNCTIONAL_TAG_TYPES = new Set([
  "ogt", // Optimize
  "remm", // Conversion Linker
  "img", // Custom Image (often used for functional pings)
]);

// LIGHTWEIGHT_PIXEL_PATTERNS, AD_VENDOR_PATTERNS, ANALYTICS_VENDOR_PATTERNS
// are imported from architecture.ts (single source of truth)

// ── Required Consent Signals by Category ──

const CONSENT_REQUIREMENTS: Record<TagDataCategory, string[]> = {
  advertising: ["ad_storage", "ad_user_data", "ad_personalization"],
  analytics: ["analytics_storage"],
  functional: [], // No consent required
  lightweight_pixel: ["ad_storage"], // Simple pixels only need ad_storage — no ad_user_data/ad_personalization
  custom_html: ["ad_storage"], // Conservative default for custom HTML
  unknown: [],
};

// ── Tag Classification ──

/**
 * Classify a tag by its data usage pattern.
 * Uses tag type first, then falls back to name/HTML content analysis.
 */
export function classifyTag(tag: GtmTag): TagDataCategory {
  // 1. Check by GTM tag type
  if (ADVERTISING_TAG_TYPES.has(tag.type)) return "advertising";
  if (ANALYTICS_TAG_TYPES.has(tag.type)) return "analytics";
  if (FUNCTIONAL_TAG_TYPES.has(tag.type)) return "functional";

  // 2. For custom HTML tags, inspect the HTML content and name
  if (tag.type === "html") {
    const htmlParam = tag.parameter?.find((p) => p.key === "html");
    const html = htmlParam?.value ?? "";
    const searchText = `${tag.name} ${html}`;

    // Check lightweight pixel vendors FIRST — they only need ad_storage
    if (LIGHTWEIGHT_PIXEL_PATTERNS.some((p) => p.test(searchText))) {
      return "lightweight_pixel";
    }

    // Check for ad vendor patterns (full advertising consent)
    if (AD_VENDOR_PATTERNS.some((p) => p.test(searchText))) {
      return "advertising";
    }

    // Check for analytics patterns
    if (ANALYTICS_VENDOR_PATTERNS.some((p) => p.test(searchText))) {
      return "analytics";
    }

    return "custom_html";
  }

  return "unknown";
}

/**
 * Get the consent signals currently configured on a tag.
 */
function getConfiguredConsent(tag: GtmTag): string[] {
  if (!tag.consentSettings || tag.consentSettings.consentStatus !== "needed") {
    return [];
  }
  return tag.consentSettings.consentType?.list?.map((c) => c.value) ?? [];
}

/**
 * Audit a single tag for Consent Mode v2 compliance.
 */
export function auditTagConsent(tag: GtmTag): ConsentTagAudit {
  const category = classifyTag(tag);
  const requiredSignals = CONSENT_REQUIREMENTS[category];
  const configuredSignals = getConfiguredConsent(tag);

  // If no consent is required for this category, it's compliant
  if (requiredSignals.length === 0) {
    return {
      tagId: tag.tagId,
      name: tag.name,
      type: tag.type,
      category,
      consentStatus: "compliant",
      signals: [],
    };
  }

  // Build signal status
  const signals: ConsentSignalStatus[] = requiredSignals.map((signal) => ({
    signal,
    required: true,
    present: configuredSignals.includes(signal),
  }));

  // Add any extra configured signals that weren't required
  for (const signal of configuredSignals) {
    if (!requiredSignals.includes(signal)) {
      signals.push({ signal, required: false, present: true });
    }
  }

  // Determine overall status
  const requiredPresent = signals.filter((s) => s.required && s.present).length;
  const requiredTotal = signals.filter((s) => s.required).length;
  const hasAnyConsent = tag.consentSettings?.consentStatus === "needed";

  let consentStatus: ConsentTagAudit["consentStatus"];
  let recommendation: string | undefined;

  if (!hasAnyConsent) {
    consentStatus = "not_configured";
    recommendation = `Add consent with: ${requiredSignals.join(", ")}`;
  } else if (requiredPresent === requiredTotal) {
    consentStatus = "compliant";
  } else if (requiredPresent > 0) {
    consentStatus = "partial";
    const missing = signals.filter((s) => s.required && !s.present).map((s) => s.signal);
    recommendation = `Missing signals: ${missing.join(", ")}`;
  } else {
    consentStatus = "non_compliant";
    recommendation = `Configure consent with: ${requiredSignals.join(", ")}`;
  }

  return {
    tagId: tag.tagId,
    name: tag.name,
    type: tag.type,
    category,
    consentStatus,
    signals,
    recommendation,
  };
}

// ── Main Audit Function ──

/**
 * Run a full Consent Mode v2 audit across all tags in the workspace.
 */
export async function auditConsentV2(): Promise<ConsentAuditReport> {
  const tags = await listTags();

  if (tags.length === 0) {
    throw new Error("Cannot connect to GTM. Run: tagops auth login");
  }

  const activeTags = tags.filter((t) => !t.paused);
  const audits = activeTags.map(auditTagConsent);

  const compliant = audits.filter((a) => a.consentStatus === "compliant").length;
  const partial = audits.filter((a) => a.consentStatus === "partial").length;
  const nonCompliant = audits.filter((a) => a.consentStatus === "non_compliant").length;
  const notConfigured = audits.filter((a) => a.consentStatus === "not_configured").length;

  // Tags that need consent (not functional/unknown)
  const auditableTags = audits.filter(
    (a) => a.category !== "functional" && a.category !== "unknown",
  );
  const auditedCount = auditableTags.length;
  const compliantCount = auditableTags.filter((a) => a.consentStatus === "compliant").length;

  const complianceScore =
    auditedCount > 0 ? Math.round((compliantCount / auditedCount) * 100) : 100;

  // Generate summary
  const issues: string[] = [];
  if (nonCompliant > 0) issues.push(`${nonCompliant} tags with wrong consent signals`);
  if (notConfigured > 0) issues.push(`${notConfigured} tags with no consent configured`);
  if (partial > 0) issues.push(`${partial} tags with incomplete consent`);

  const summary =
    issues.length > 0
      ? `${complianceScore}% compliant — ${issues.join(", ")}`
      : "100% compliant — all tags properly configured for Consent Mode v2";

  return {
    timestamp: new Date().toISOString(),
    totalTags: tags.length,
    auditedTags: auditedCount,
    compliantTags: compliant,
    partialTags: partial,
    nonCompliantTags: nonCompliant,
    notConfiguredTags: notConfigured,
    complianceScore,
    tags: audits,
    summary,
  };
}

// ── Auto-Fix ──

/**
 * Fix non-compliant tags by adding the required consent signals.
 * Returns the count of tags fixed.
 */
export async function fixConsentV2(
  dryRun = false,
): Promise<{ fixed: number; skipped: number; errors: number; actions: string[] }> {
  if (!dryRun) {
    await requireWriteAccess();
  }

  const report = await auditConsentV2();
  const toFix = report.tags.filter(
    (t) =>
      t.consentStatus === "non_compliant" ||
      t.consentStatus === "not_configured" ||
      t.consentStatus === "partial",
  );

  let fixed = 0;
  let skipped = 0;
  let errors = 0;
  const actions: string[] = [];

  const tags = await listTags();

  // Auto-backup before first real write
  if (!dryRun && toFix.length > 0) {
    await createPreFixBackup("consent-audit");
  }

  for (const audit of toFix) {
    const tag = tags.find((t) => t.tagId === audit.tagId);
    if (!tag) {
      skipped++;
      continue;
    }

    const requiredSignals = CONSENT_REQUIREMENTS[audit.category];
    if (requiredSignals.length === 0) {
      skipped++;
      continue;
    }

    // Merge existing + required signals
    const existingSignals = getConfiguredConsent(tag);
    const allSignals = [...new Set([...existingSignals, ...requiredSignals])];

    const newConsentSettings = {
      consentStatus: "needed" as const,
      consentType: {
        type: "list" as const,
        list: allSignals.map((s) => ({ type: "template", value: s })),
      },
    };

    if (dryRun) {
      actions.push(
        `[DRY RUN] Would fix tag ${tag.tagId} (${tag.name}): add ${requiredSignals.join(", ")}`,
      );
      fixed++;
    } else {
      try {
        const fullTag = await getTag(tag.tagId);
        if (!fullTag) {
          actions.push(`Error fixing tag ${tag.tagId} (${tag.name}): tag no longer exists`);
          errors++;
          continue;
        }

        await updateTag({
          tagId: fullTag.tagId,
          name: fullTag.name,
          fingerprint: fullTag.fingerprint,
          config: buildCompleteTagConfig(fullTag, {
            consentSettings: newConsentSettings,
          }),
        });
        actions.push(`Fixed tag ${tag.tagId} (${tag.name}): added ${requiredSignals.join(", ")}`);
        fixed++;
      } catch (err) {
        actions.push(`Error fixing tag ${tag.tagId} (${tag.name}): ${(err as Error).message}`);
        errors++;
      }
    }
  }

  return { fixed, skipped, errors, actions };
}

// ── CLI Output ──

/**
 * Print a rich, formatted consent audit report to the console.
 */
export function printConsentReport(report: ConsentAuditReport): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(chalk.bold("  Consent Mode v2 Compliance Audit"));
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  // Score badge
  const scoreColor =
    report.complianceScore >= 90
      ? chalk.green
      : report.complianceScore >= 60
        ? chalk.yellow
        : chalk.red;

  console.log(`  Compliance Score: ${scoreColor(chalk.bold(`${report.complianceScore}%`))}`);
  console.log(`  Total Tags: ${report.totalTags} | Audited: ${report.auditedTags}`);
  console.log(
    `  ${chalk.green("✔")} Compliant: ${report.compliantTags} | ${chalk.yellow("⚠")} Partial: ${report.partialTags} | ${chalk.red("✖")} Non-compliant: ${report.nonCompliantTags + report.notConfiguredTags}\n`,
  );

  // Detailed breakdown by category
  const categories: TagDataCategory[] = [
    "advertising",
    "lightweight_pixel",
    "analytics",
    "custom_html",
  ];
  for (const cat of categories) {
    const catTags = report.tags.filter((t) => t.category === cat);
    if (catTags.length === 0) continue;

    const label =
      cat === "custom_html" ? "Custom HTML" : cat.charAt(0).toUpperCase() + cat.slice(1);
    console.log(chalk.underline(`  ${label} Tags (${catTags.length})`));

    for (const tag of catTags) {
      const icon =
        tag.consentStatus === "compliant"
          ? chalk.green("✔")
          : tag.consentStatus === "partial"
            ? chalk.yellow("⚠")
            : chalk.red("✖");

      const signals = tag.signals
        .filter((s) => s.required)
        .map((s) => (s.present ? chalk.green(s.signal) : chalk.red(s.signal)))
        .join(", ");

      console.log(`    ${icon} ${tag.name} [${signals || "none"}]`);
      if (tag.recommendation) {
        console.log(`      ${chalk.dim("→ " + tag.recommendation)}`);
      }
    }
    console.log();
  }

  // Summary
  console.log(chalk.bold("──────────────────────────────────────────────────"));
  console.log(`  ${report.summary}`);

  if (report.complianceScore < 100) {
    console.log(
      chalk.cyan("\n  Run `tagops consent-audit --fix` to auto-remediate non-compliant tags."),
    );
  }
  console.log();
}
