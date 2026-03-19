/**
 * Enhanced Conversion Validator
 *
 * Validates that Google Ads enhanced conversions are correctly configured
 * per the 2025 GTM changes (separate user-provided data event tag).
 *
 * Usage:
 *   tagops enhanced-conversions
 */

import chalk from "chalk";
import type { GtmTag } from "../types/gtm.js";

// Tag types that represent Google Ads conversions
const GOOGLE_ADS_CONVERSION_TYPES = new Set(["awct", "sp", "gclidw"]);
const GOOGLE_ADS_TAG_TYPES = new Set(["awct", "sp", "gclidw", "gaawe", "googtag"]);
const USER_PROVIDED_DATA_TAG_TYPE = "awud";

export interface EnhancedConversionIssue {
  tagId: string;
  tagName: string;
  issue: string;
  severity: "error" | "warning";
  fix?: string;
}

export interface EnhancedConversionReport {
  timestamp: string;
  totalConversionTags: number;
  userDataTags: number;
  issues: EnhancedConversionIssue[];
  score: number; // 0-100
  summary: string;
}

/**
 * Check if a tag collects user-provided data (email, phone, etc.)
 */
function collectsUserData(tag: GtmTag): boolean {
  if (!tag.parameter) return false;
  const userDataKeys = [
    "email",
    "phone_number",
    "first_name",
    "last_name",
    "street",
    "city",
    "region",
    "postal_code",
    "country",
  ];
  return tag.parameter.some((p) =>
    userDataKeys.some(
      (k) => p.key?.toLowerCase().includes(k) || p.value?.toLowerCase().includes(k),
    ),
  );
}

/**
 * Find which trigger IDs a tag fires on.
 */
function getFireTriggers(tag: GtmTag): string[] {
  return tag.firingTriggerId ?? [];
}

/**
 * Run enhanced conversion validation against a set of tags.
 */
export function validateEnhancedConversions(tags: GtmTag[]): EnhancedConversionReport {
  const issues: EnhancedConversionIssue[] = [];

  // Find conversion tags and user-provided data tags
  const conversionTags = tags.filter((t) => GOOGLE_ADS_CONVERSION_TYPES.has(t.type) && !t.paused);
  const userDataTags = tags.filter((t) => t.type === USER_PROVIDED_DATA_TAG_TYPE && !t.paused);

  // Issue 1: No user-provided data tags at all
  if (conversionTags.length > 0 && userDataTags.length === 0) {
    issues.push({
      tagId: "—",
      tagName: "Container",
      issue:
        "No 'Google Ads User-provided Data Event' tags found. Enhanced conversions require a separate user-data tag.",
      severity: "error",
      fix: "Create a 'Google Ads User-provided Data Event' tag and configure it to fire before your conversion tags.",
    });
  }

  // Issue 2: Check each conversion tag has a matching user-data tag on the same triggers
  for (const convTag of conversionTags) {
    const convTriggers = new Set(getFireTriggers(convTag));

    // Find a user-data tag that fires on at least one of the same triggers
    const matchingUserDataTag = userDataTags.find((udt) =>
      getFireTriggers(udt).some((tid) => convTriggers.has(tid)),
    );

    if (!matchingUserDataTag && userDataTags.length > 0) {
      issues.push({
        tagId: convTag.tagId,
        tagName: convTag.name,
        issue:
          "This conversion tag has no matching user-data tag on the same trigger. Enhanced conversions won't fire.",
        severity: "error",
        fix: `Ensure a User-provided Data Event tag fires on the same trigger(s): ${[...convTriggers].join(", ")}`,
      });
    }

    // Issue 3: Check consent settings on conversion tags
    if (!convTag.consentSettings || convTag.consentSettings.consentStatus === "notSet") {
      issues.push({
        tagId: convTag.tagId,
        tagName: convTag.name,
        issue: "Conversion tag has no consent settings configured.",
        severity: "warning",
        fix: "Set consent to 'needed' and add required signals (ad_storage, ad_user_data).",
      });
    }
  }

  // Issue 4: Check user-data tags have proper configuration
  for (const udtTag of userDataTags) {
    if (!collectsUserData(udtTag)) {
      issues.push({
        tagId: udtTag.tagId,
        tagName: udtTag.name,
        issue:
          "User-provided data tag doesn't appear to collect any user data fields (email, phone, etc.).",
        severity: "warning",
        fix: "Configure the tag to collect at least email or phone number from form fields or data layer.",
      });
    }

    // Check consent on user-data tags too
    if (!udtTag.consentSettings || udtTag.consentSettings.consentStatus === "notSet") {
      issues.push({
        tagId: udtTag.tagId,
        tagName: udtTag.name,
        issue:
          "User-provided data tag has no consent configured — PII collection requires consent.",
        severity: "error",
        fix: "Set consent to 'needed' and add ad_storage + ad_user_data signals.",
      });
    }
  }

  // Score calculation
  const totalCheckpoints = Math.max(conversionTags.length * 2 + userDataTags.length, 1);
  const errorCount = issues.filter((i) => i.severity === "error").length;
  const warningCount = issues.filter((i) => i.severity === "warning").length;
  const deductions = errorCount * 20 + warningCount * 5;
  const score = Math.max(0, Math.min(100, 100 - deductions));

  const summary =
    conversionTags.length === 0
      ? "No Google Ads conversion tags found — enhanced conversions not applicable."
      : issues.length === 0
        ? `All ${conversionTags.length} conversion tag(s) properly configured with enhanced conversions.`
        : `${issues.filter((i) => i.severity === "error").length} errors, ${issues.filter((i) => i.severity === "warning").length} warnings across ${conversionTags.length} conversion tag(s).`;

  return {
    timestamp: new Date().toISOString(),
    totalConversionTags: conversionTags.length,
    userDataTags: userDataTags.length,
    issues,
    score,
    summary,
  };
}

/**
 * Print a formatted enhanced conversion report.
 */
export function printEnhancedConversionReport(report: EnhancedConversionReport): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(chalk.bold("  Enhanced Conversion Validator"));
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  console.log(`  Conversion Tags: ${report.totalConversionTags}`);
  console.log(`  User-Data Tags:  ${report.userDataTags}`);

  const scoreColor =
    report.score >= 80 ? chalk.green : report.score >= 50 ? chalk.yellow : chalk.red;
  console.log(`  Score:           ${scoreColor(`${report.score}%`)}\n`);

  if (report.issues.length === 0) {
    console.log(`  ${chalk.green("✔")} All enhanced conversions properly configured.\n`);
    return;
  }

  for (const issue of report.issues) {
    const icon = issue.severity === "error" ? chalk.red("✖") : chalk.yellow("⚠");
    console.log(`  ${icon} [${issue.tagName}] ${issue.issue}`);
    if (issue.fix) {
      console.log(`    ${chalk.dim("→ " + issue.fix)}`);
    }
  }

  console.log(`\n${chalk.bold("──────────────────────────────────────────────────")}`);
  console.log(`  ${report.summary}\n`);
}
