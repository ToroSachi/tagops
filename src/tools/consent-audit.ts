import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

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
import {
  buildCompleteTagConfig,
  buildConsentConfig,
  getTag,
  listTags,
  updateTag,
} from "../lib/gtm-cli.js";
import {
  AD_VENDOR_PATTERNS,
  ANALYTICS_VENDOR_PATTERNS,
  FUNCTIONAL_VENDOR_PATTERNS,
  LIGHTWEIGHT_PIXEL_PATTERNS,
  PERSONALIZATION_VENDOR_PATTERNS,
  SECURITY_VENDOR_PATTERNS,
} from "../lib/architecture.js";
import {
  getConfiguredConsentSignals,
  getRequiredConsentSignalsForTag,
  getTagSearchText,
} from "../lib/policies.js";
import { createPreFixBackup } from "../lib/pre-fix-backup.js";
import { getSafeErrorMessage } from "../lib/redaction.js";
import { requireWriteAccess } from "../lib/permission-guard.js";
import type {
  ConsentSignalStatus,
  ConsentTagAudit,
  ConsentAuditReport,
  GtmConsentSignalValue,
  GtmTag,
  TagDataCategory,
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
]);

function inferCategoryFromSearchText(searchText: string): TagDataCategory | null {
  if (LIGHTWEIGHT_PIXEL_PATTERNS.some((pattern) => pattern.test(searchText))) {
    return "lightweight_pixel";
  }

  if (AD_VENDOR_PATTERNS.some((pattern) => pattern.test(searchText))) {
    return "advertising";
  }

  if (ANALYTICS_VENDOR_PATTERNS.some((pattern) => pattern.test(searchText))) {
    return "analytics";
  }

  if (FUNCTIONAL_VENDOR_PATTERNS.some((pattern) => pattern.test(searchText))) {
    return "functional";
  }

  if (PERSONALIZATION_VENDOR_PATTERNS.some((pattern) => pattern.test(searchText))) {
    return "personalization";
  }

  if (SECURITY_VENDOR_PATTERNS.some((pattern) => pattern.test(searchText))) {
    return "security";
  }

  return null;
}

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

  // 2. For Custom HTML/Image tags, inspect the content and name
  if (tag.type === "html" || tag.type === "img") {
    const inferredCategory = inferCategoryFromSearchText(getTagSearchText(tag));
    if (inferredCategory) {
      return inferredCategory;
    }

    return tag.type === "img" ? "lightweight_pixel" : "custom_html";
  }

  return "unknown";
}

/**
 * Audit a single tag for Consent Mode v2 compliance.
 */
export function auditTagConsent(tag: GtmTag): ConsentTagAudit {
  const category = classifyTag(tag);
  const requiredSignals = getRequiredConsentSignalsForTag(tag);
  const configuredSignals = getConfiguredConsentSignals(tag);

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

  // Tags that need explicit consent signals
  const auditableTags = audits.filter((audit) => audit.signals.some((signal) => signal.required));
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

// ── EU data-loss exposure estimate ──

export interface SavingsEstimateInput {
  monthlyConversions: number;
  avgValue: number;
  eeaShare: number; // 0-1; default 0.3 if unspecified
  currency?: string; // cosmetic only, default "$"
}

export interface SavingsEstimate {
  eeaShare: number;
  monthlyConversions: number;
  avgValue: number;
  currency: string;
  affectedFraction: number; // share of consent-required tags that are non-compliant/unconfigured
  monthlyAffectedConversions: number;
  monthlyExposureValue: number; // gross exposure (no recovery assumption)
  monthlyPermanentLoss: number; // ~60% of exposure, based on published ~40% modeling recovery
  yearlyPermanentLoss: number;
}

/**
 * Translate an audit report + traffic assumptions into an estimated dollar exposure.
 *
 * Recovery assumption: Google's behavioral modeling recovers roughly 40% of lost
 * observed conversions (published field data: Harvest Digital / Matomo).
 * Permanent loss ≈ 60% of the exposed value. We surface both so readers can pick.
 */
export function estimateEuDataLoss(
  report: ConsentAuditReport,
  input: SavingsEstimateInput,
): SavingsEstimate {
  const eeaShare = Math.max(0, Math.min(1, input.eeaShare));
  const affected = report.nonCompliantTags + report.notConfiguredTags;
  const consentRequired = affected + report.compliantTags + report.partialTags;
  const affectedFraction = consentRequired > 0 ? affected / consentRequired : 0;

  const monthlyAffected = input.monthlyConversions * eeaShare * affectedFraction;
  const monthlyExposureValue = monthlyAffected * input.avgValue;
  const monthlyPermanentLoss = monthlyExposureValue * 0.6;

  return {
    eeaShare,
    monthlyConversions: input.monthlyConversions,
    avgValue: input.avgValue,
    currency: input.currency ?? "$",
    affectedFraction,
    monthlyAffectedConversions: Math.round(monthlyAffected),
    monthlyExposureValue: Math.round(monthlyExposureValue),
    monthlyPermanentLoss: Math.round(monthlyPermanentLoss),
    yearlyPermanentLoss: Math.round(monthlyPermanentLoss * 12),
  };
}

export function printSavingsEstimate(estimate: SavingsEstimate): void {
  const c = estimate.currency;
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  console.log();
  console.log(chalk.bold("  EU data-loss exposure estimate"));
  console.log(
    `    Inputs: ${estimate.monthlyConversions} conversions/mo · ${pct(
      estimate.eeaShare,
    )} EEA share · ${c}${estimate.avgValue} avg value`,
  );
  console.log(`    Non-compliant tag share: ${pct(estimate.affectedFraction)}`);
  console.log();
  console.log(`    Affected conversions/mo:   ~${estimate.monthlyAffectedConversions}`);
  console.log(
    `    Gross monthly exposure:    ~${c}${estimate.monthlyExposureValue.toLocaleString()}`,
  );
  console.log(
    `    ${chalk.bold("Permanent loss/mo (est.):")}  ~${c}${estimate.monthlyPermanentLoss.toLocaleString()}  ${chalk.dim(
      "(~60% of exposure; ~40% recovered by Google modeling)",
    )}`,
  );
  console.log(
    `    ${chalk.bold("Yearly permanent loss:")}     ~${c}${estimate.yearlyPermanentLoss.toLocaleString()}`,
  );
  console.log(
    chalk.dim(
      "    Estimate only. Actual loss depends on traffic mix, tag-specific value contribution, and CMP behavior.",
    ),
  );
  console.log();
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

    const requiredSignals = audit.signals
      .filter((signal) => signal.required)
      .map((signal) => signal.signal as GtmConsentSignalValue);
    if (requiredSignals.length === 0) {
      skipped++;
      continue;
    }

    // Merge existing + required signals
    const existingSignals = getConfiguredConsentSignals(tag);
    const allSignals = [...new Set([...existingSignals, ...requiredSignals])];
    const newConsentSettings = buildConsentConfig(allSignals);

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
        actions.push(`Error fixing tag ${tag.tagId} (${tag.name}): ${getSafeErrorMessage(err)}`);
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
    "functional",
    "personalization",
    "security",
    "custom_html",
  ];
  for (const cat of categories) {
    const catTags = report.tags.filter((t) => t.category === cat);
    if (catTags.length === 0) continue;

    const label =
      cat === "custom_html"
        ? "Custom HTML"
        : cat === "lightweight_pixel"
          ? "Lightweight Pixel"
          : cat.charAt(0).toUpperCase() + cat.slice(1);
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

// ── Risk Level Helper ──

function getRiskLevel(score: number): { label: string; emoji: string } {
  if (score >= 90) return { label: "Low Risk", emoji: "🟢" };
  if (score >= 70) return { label: "Moderate Risk", emoji: "🟡" };
  if (score >= 40) return { label: "High Risk", emoji: "🟠" };
  return { label: "Critical Risk", emoji: "🔴" };
}

function getGrade(score: number): string {
  if (score >= 97) return "A+";
  if (score >= 93) return "A";
  if (score >= 90) return "A-";
  if (score >= 87) return "B+";
  if (score >= 83) return "B";
  if (score >= 80) return "B-";
  if (score >= 70) return "C";
  if (score >= 60) return "D";
  return "F";
}

// ── Markdown Report Generator ──

/**
 * Generate a professional, shareable Markdown consent compliance report.
 *
 * This is the core Phase 1 deliverable — designed to be alarming, quantified,
 * and shareable so it creates its own demand. The report includes:
 *   - Executive summary with compliance grade and risk level
 *   - Estimated EU data loss percentage
 *   - Per-category breakdown with signal matrices
 *   - Actionable remediation recommendations
 *   - TagOps branding
 */
export function generateConsentMarkdownReport(
  report: ConsentAuditReport,
  containerInfo?: { accountId?: string; containerId?: string },
): string {
  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);
  const now = new Date().toLocaleString();
  const risk = getRiskLevel(report.complianceScore);
  const grade = getGrade(report.complianceScore);

  // ── Header ──
  ln("# 🔒 Consent Mode v2 Compliance Report");
  ln();
  ln(`> Generated on ${now} by [TagOps CLI](https://github.com/ToroSachi/tagops)`);
  if (containerInfo?.accountId || containerInfo?.containerId) {
    ln(
      `> Container: \`${containerInfo.accountId ?? "—"}\` / \`${containerInfo.containerId ?? "—"}\``,
    );
  }
  ln();

  // ── Executive Summary ──
  ln("## Executive Summary");
  ln();
  ln(`| Metric | Value |`);
  ln(`|--------|-------|`);
  ln(`| **Compliance Grade** | **${grade}** (${report.complianceScore}/100) |`);
  ln(`| **Risk Level** | ${risk.emoji} ${risk.label} |`);
  ln(`| Total Tags | ${report.totalTags} |`);
  ln(`| Tags Requiring Consent | ${report.auditedTags} |`);
  ln(`| ✅ Fully Compliant | ${report.compliantTags} |`);
  ln(`| ⚠️ Partially Compliant | ${report.partialTags} |`);
  ln(`| ❌ Non-Compliant | ${report.nonCompliantTags} |`);
  ln(`| 🚫 No Consent Configured | ${report.notConfiguredTags} |`);
  ln();

  // ── Estimated Data Loss ──
  const nonCompliantCount = report.nonCompliantTags + report.notConfiguredTags;
  const partialCount = report.partialTags;

  if (nonCompliantCount > 0 || partialCount > 0) {
    ln("## ⚠️ Estimated EU Data Loss");
    ln();
    ln("Google enforces Consent Mode v2 for all EEA/UK traffic as of **July 21, 2025**.");
    ln("Non-compliant tags lose conversion data **permanently with no backfill option**.");
    ln();

    // Calculate estimated impact
    // Non-compliant tags: 100% loss of EU/UK conversion data for those tags
    // Partial tags: ~50% loss (some signals present, some missing)
    // Industry benchmark: EU users deny consent 50–80% of the time
    const totalAudited = report.auditedTags || 1;
    const fullLossRatio = nonCompliantCount / totalAudited;
    const partialLossRatio = partialCount / totalAudited;
    const estimatedDataLoss = Math.round(fullLossRatio * 100 + partialLossRatio * 50);

    ln(`| Impact Area | Estimated Loss |`);
    ln(`|-------------|---------------|`);
    ln(
      `| **Tags with total EU data loss** | ${nonCompliantCount} of ${report.auditedTags} (${Math.round(fullLossRatio * 100)}%) |`,
    );
    if (partialCount > 0) {
      ln(
        `| **Tags with partial EU data loss** | ${partialCount} of ${report.auditedTags} (${Math.round(partialLossRatio * 100)}%) |`,
      );
    }
    ln(
      `| **Overall signal loss estimate** | ~${Math.min(estimatedDataLoss, 100)}% of EU conversion data |`,
    );
    ln();

    if (estimatedDataLoss >= 50) {
      ln("> **🚨 CRITICAL:** More than half of your EU conversion data may be affected.");
      ln("> This means ad optimization (Google Ads Smart Bidding, Meta CBO) is operating");
      ln("> on incomplete data, leading to inflated CPAs and misallocated spend.");
    } else if (estimatedDataLoss >= 20) {
      ln("> **⚠️ WARNING:** A significant portion of your EU conversion data is at risk.");
      ln("> Google Ads and GA4 reporting for EEA/UK traffic may be materially undercounting.");
    }
    ln();
  }

  // ── Detailed Findings by Category ──
  ln("## Detailed Findings");
  ln();

  const categories: { key: TagDataCategory; label: string }[] = [
    { key: "advertising", label: "🎯 Advertising Tags" },
    { key: "lightweight_pixel", label: "📡 Tracking Pixels" },
    { key: "analytics", label: "📊 Analytics Tags" },
    { key: "personalization", label: "🧩 Personalization Tags" },
    { key: "functional", label: "⚙️ Functional Tags" },
    { key: "custom_html", label: "📝 Custom HTML Tags" },
    { key: "security", label: "🔐 Security Tags" },
  ];

  for (const { key, label } of categories) {
    const catTags = report.tags.filter((t) => t.category === key);
    if (catTags.length === 0) continue;

    const catCompliant = catTags.filter((t) => t.consentStatus === "compliant").length;
    const catTotal = catTags.length;
    const catScore = catTotal > 0 ? Math.round((catCompliant / catTotal) * 100) : 100;

    ln(`### ${label}`);
    ln();
    ln(`**${catCompliant}/${catTotal}** compliant (${catScore}%)`);
    ln();

    // Signal matrix table
    ln(`| Status | Tag Name | Type | Required Signals | Recommendation |`);
    ln(`|--------|----------|------|-----------------|----------------|`);

    for (const tag of catTags) {
      const icon =
        tag.consentStatus === "compliant" ? "✅" : tag.consentStatus === "partial" ? "⚠️" : "❌";

      const signalList = tag.signals
        .filter((s) => s.required)
        .map((s) => (s.present ? `~~${s.signal}~~` : `**${s.signal}**`))
        .join(", ");

      const rec = tag.recommendation ?? "—";
      ln(`| ${icon} | ${tag.name} | \`${tag.type}\` | ${signalList || "none"} | ${rec} |`);
    }
    ln();
  }

  // ── Unknown / uncategorized tags ──
  const unknownTags = report.tags.filter((t) => t.category === "unknown");
  if (unknownTags.length > 0) {
    ln("### ❓ Uncategorized Tags");
    ln();
    ln(
      "These tags could not be automatically classified. Review manually to determine if they handle user data.",
    );
    ln();
    ln(`| Tag Name | Type |`);
    ln(`|----------|------|`);
    for (const tag of unknownTags) {
      ln(`| ${tag.name} | \`${tag.type}\` |`);
    }
    ln();
  }

  // ── Recommendations ──
  ln("## Recommendations");
  ln();

  if (report.complianceScore === 100) {
    ln("✅ **All tags are properly configured for Consent Mode v2.** No action required.");
    ln();
    ln("To maintain compliance:");
    ln("- Run `tagops consent-audit` in CI to catch regressions");
    ln("- Use `tagops watch` for continuous drift detection");
    ln("- Review consent settings whenever new tags are added");
  } else {
    ln("### Immediate Actions");
    ln();

    if (report.notConfiguredTags > 0) {
      ln(
        `1. **${report.notConfiguredTags} tags have no consent configured at all.** These tags fire without any consent check, violating GDPR requirements. Run \`tagops consent-audit --fix\` to auto-remediate.`,
      );
    }
    if (report.nonCompliantTags > 0) {
      ln(
        `${report.notConfiguredTags > 0 ? "2" : "1"}. **${report.nonCompliantTags} tags have incorrect consent signals.** They declare consent but are missing required signals. Run \`tagops consent-audit --fix\` to add the missing signals.`,
      );
    }
    if (report.partialTags > 0) {
      ln(
        `${(report.notConfiguredTags > 0 ? 1 : 0) + (report.nonCompliantTags > 0 ? 1 : 0) + 1}. **${report.partialTags} tags have incomplete consent coverage.** Some required signals are present but others are missing.`,
      );
    }

    ln();
    ln("### Ongoing Protection");
    ln();
    ln("- Add `tagops consent-audit --score-only` to your CI pipeline to prevent regressions");
    ln("- Use `tagops policy-check` with the `consent-v2-advertising` policy pack");
    ln("- Set up `tagops watch` with Slack alerts for consent drift detection");
    ln("- Schedule weekly reports with `tagops report --output reports/`");
  }
  ln();

  // ── Methodology ──
  ln("---");
  ln();
  ln("## Methodology");
  ln();
  ln("This report was generated by TagOps CLI's Consent Mode v2 auditor, which:");
  ln();
  ln(
    "1. **Classifies** every tag by data usage pattern (advertising, analytics, functional, etc.)",
  );
  ln(
    "2. **Maps** required consent signals based on classification (e.g., advertising tags require `ad_storage`, `ad_user_data`, `ad_personalization`)",
  );
  ln("3. **Verifies** that each tag has the correct consent settings configured in GTM");
  ln(
    "4. **Scores** overall compliance as the ratio of fully-compliant tags to total auditable tags",
  );
  ln();
  ln(
    "Data loss estimates are based on Google's July 2025 enforcement behavior, where non-compliant tags have conversion tracking, remarketing, and ad personalization silently disabled for EEA/UK traffic.",
  );
  ln();
  ln("---");
  ln();
  ln(
    "*Generated by [TagOps](https://github.com/ToroSachi/tagops) — Infrastructure-as-Code for Google Tag Manager*",
  );

  return lines.join("\n");
}

// ── Report File Output ──

export interface ConsentReportResult {
  outputPath: string;
  complianceScore: number;
  grade: string;
  riskLevel: string;
  nonCompliantCount: number;
}

/**
 * Run a consent audit and write a shareable Markdown report to disk.
 */
export async function runConsentReport(
  outputPath?: string,
  containerInfo?: { accountId?: string; containerId?: string },
): Promise<ConsentReportResult> {
  const report = await auditConsentV2();
  const markdown = generateConsentMarkdownReport(report, containerInfo);

  const filename = outputPath ?? `consent-report-${new Date().toISOString().split("T")[0]}.md`;
  const absolutePath = resolve(filename);
  writeFileSync(absolutePath, markdown);

  const grade = getGrade(report.complianceScore);
  const risk = getRiskLevel(report.complianceScore);

  return {
    outputPath: absolutePath,
    complianceScore: report.complianceScore,
    grade,
    riskLevel: risk.label,
    nonCompliantCount: report.nonCompliantTags + report.notConfiguredTags,
  };
}

/**
 * Print a summary of the generated report to the console.
 */
export function printConsentReportResult(result: ConsentReportResult): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(chalk.bold("  Consent Mode v2 Compliance Report Generated"));
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  console.log(`  📄 Report:  ${chalk.cyan(result.outputPath)}`);
  console.log(`  🏆 Grade:   ${chalk.bold(result.grade)} (${result.complianceScore}/100)`);
  console.log(`  ⚡ Risk:    ${result.riskLevel}`);
  if (result.nonCompliantCount > 0) {
    console.log(`  ❌ Issues:  ${chalk.red(`${result.nonCompliantCount} non-compliant tags`)}`);
  } else {
    console.log(`  ✅ Status:  ${chalk.green("All tags compliant")}`);
  }
  console.log();
  console.log(
    chalk.gray("  Share this report with your team or attach it to a compliance review.\n"),
  );
}
