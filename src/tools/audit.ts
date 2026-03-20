/**
 * Audit GTM workspace for common misconfigurations.
 *
 * Checks for:
 *   - Tags with no firing triggers (dead tags)
 *   - Advertising tags with wrong consent settings
 *   - Meta tags missing eventID for deduplication
 *   - Tags with supportDocumentWrite enabled (security risk)
 *   - Unlimited firing tags (SPA duplicate risk)
 *   - Unlimited firing tags (SPA duplicate risk)
 *   - Missing variable references (e.g. {{Deleted Var}})
 *   - Orphaned triggers (not used by any tag)
 *   - Duplicate tag names
 *   - Paused tags
 *
 * Usage:
 *   npx tsx src/cli.ts audit
 */

import chalk from "chalk";
import crypto from "crypto";
import { confirm } from "@inquirer/prompts";
import { getSafeErrorMessage } from "../lib/redaction.js";
import {
  listTags,
  listTriggers,
  listVariables,
  deleteTrigger,
  deleteVariable,
} from "../lib/gtm-cli.js";
import { BUILTIN_TRIGGER_IDS, isLightweightPixel, isAdVendor } from "../lib/architecture.js";
import { requireWriteAccess } from "../lib/permission-guard.js";
import type { AuditIssue, AuditReport, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

// Risky patterns in Custom HTML that indicate security/injection risks
const RISKY_HTML_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /eval\s*\(/i, label: "eval()" },
  { pattern: /document\.cookie/i, label: "document.cookie" },
  { pattern: /\.innerHTML\s*=/i, label: "innerHTML assignment" },
  { pattern: /new\s+Function\s*\(/i, label: "new Function()" },
];

function getTagSearchText(tag: GtmTag): string {
  return tag.name + " " + (tag.parameter?.find((p) => p.key === "html")?.value ?? "");
}

function isLightweightPixelTag(tag: GtmTag): boolean {
  return isLightweightPixel(getTagSearchText(tag));
}

function isAdVendorTag(tag: GtmTag): boolean {
  return isAdVendor(getTagSearchText(tag));
}

/**
 * Run a full audit and return a structured report.
 * This function is used by both the CLI and MCP server.
 */
export async function auditWorkspace(): Promise<AuditReport> {
  const tags = await listTags();
  const triggers = await listTriggers();
  const variables = await listVariables();

  if (tags.length === 0 && triggers.length === 0) {
    throw new Error("Cannot connect to GTM. Run: tagops auth login");
  }

  const issues: AuditIssue[] = [];
  const triggerUsage: Record<string, string[]> = {};

  // Initialize trigger usage tracking
  for (const t of triggers) {
    triggerUsage[t.triggerId] = [];
  }

  // Track tag names for duplicate detection
  const tagNameCounts = new Map<string, string[]>();

  // Track exact hash configuration for exact duplicate detection
  const tagHashes = new Map<string, Array<{ id: string; name: string }>>();

  // Check each tag
  for (const tag of tags) {
    const firing = tag.firingTriggerId ?? [];

    // Track trigger usage
    for (const tid of firing) {
      if (triggerUsage[tid]) {
        triggerUsage[tid].push(tag.name);
      }
    }

    // Track tag name duplicates
    const existing = tagNameCounts.get(tag.name) ?? [];
    existing.push(tag.tagId);
    tagNameCounts.set(tag.name, existing);

    // Check 1: Missing triggers
    if (firing.length === 0 && !tag.paused) {
      issues.push({
        type: "NO_TRIGGERS",
        tagId: tag.tagId,
        name: tag.name,
        detail: "Tag has no firing triggers — it will never fire",
      });
    }

    // Check 2: Consent settings
    if (!tag.paused) {
      if (isAdVendorTag(tag)) {
        checkAdVendorConsent(tag, issues);
      } else if (isLightweightPixelTag(tag)) {
        checkLightweightPixelConsent(tag, issues);
      }
    }

    // Check 3: Meta-specific eventID check
    if ((tag.name?.includes("Meta") || tag.name?.includes("meta")) && tag.type === "html") {
      checkMetaEventId(tag, issues);
    }

    // Check 4: supportDocumentWrite enabled (perf/security risk)
    if (tag.type === "html" && !tag.paused) {
      checkDocumentWrite(tag, issues);
      // Check 4b: Custom HTML security scan
      checkCustomHtmlSecurity(tag, issues);
    }

    // Check 3b: Unlimited firing (SPA duplicate risk)
    if (!tag.paused) {
      const firingOption = tag.tagFiringOption ?? "unlimited";
      if (firingOption === "unlimited") {
        issues.push({
          type: "UNLIMITED_FIRING",
          tagId: tag.tagId,
          name: tag.name,
          detail:
            "Tag has unlimited firing — will fire on every SPA route change/hydration. Set to oncePerEvent or oncePerLoad.",
        });
      }
    } else {
      // It IS paused
      issues.push({
        type: "PAUSED_TAG",
        tagId: tag.tagId,
        name: tag.name,
        detail:
          "Tag is paused. Consider deleting it to keep the container clean and reduce payload weight.",
      });
    }

    // Check 4: Tag Naming Convention
    if (!tag.name.includes("-") && !tag.name.includes("–") && !tag.paused && tag.type !== "gaawe") {
      issues.push({
        type: "BAD_NAMING_CONVENTION",
        tagId: tag.tagId,
        name: tag.name,
        detail: "Tag lacks a strictly formatted 'Vendor - Action' namespace",
      });
    }

    // Check 5: GA4 E-commerce Schema
    if (tag.type === "gaawe" && !tag.paused) {
      const eventName = tag.parameter?.find((p) => p.key === "eventName")?.value;
      if (
        eventName &&
        ["purchase", "view_item", "begin_checkout", "add_to_cart"].includes(eventName)
      ) {
        const payloadStr = JSON.stringify(tag.parameter);
        const missing = [];
        if (!payloadStr.includes(`"value":"items"`)) missing.push("items");
        if (!payloadStr.includes(`"value":"value"`)) missing.push("value");
        if (eventName === "purchase" && !payloadStr.includes(`"value":"transaction_id"`))
          missing.push("transaction_id");

        if (missing.length > 0) {
          issues.push({
            type: "GA4_MISSING_PARAMS",
            tagId: tag.tagId,
            name: tag.name,
            detail: `GA4 Ecommerce tag is missing required data layer maps: ${missing.join(", ")}`,
          });
        }
      }
    }

    // Hash tag payload for duplicate check (ignore name & IDs)
    const payloadOpts = {
      type: tag.type,
      config: tag.parameter,
      consent: tag.consentSettings,
      firing: tag.firingTriggerId?.slice().sort(),
      blocking: tag.blockingTriggerId?.slice().sort(),
      firingOpt: tag.tagFiringOption,
    };
    const hash = crypto.createHash("sha256").update(JSON.stringify(payloadOpts)).digest("hex");
    const existingHashGroup = tagHashes.get(hash) ?? [];
    existingHashGroup.push({ id: tag.tagId, name: tag.name });
    tagHashes.set(hash, existingHashGroup);
  }

  // Check 6: Missing variable references
  const variableNames = new Set(variables.map((v) => v.name));
  checkMissingVariables(tags, triggers, variableNames, issues);

  // Check 7: Orphaned triggers
  for (const [tid, users] of Object.entries(triggerUsage)) {
    if (users.length === 0 && !BUILTIN_TRIGGER_IDS.has(tid)) {
      const trigger = triggers.find((t) => t.triggerId === tid);
      issues.push({
        type: "ORPHANED_TRIGGER",
        triggerId: tid,
        name: trigger?.name ?? "Unknown",
        detail: "Trigger is not used by any tag",
      });
    }
  }

  // Enforce trigger naming conventions
  for (const trigger of triggers) {
    if (BUILTIN_TRIGGER_IDS.has(trigger.triggerId)) continue;
    const validPrefixes = [
      "CE - ",
      "CE – ",
      "META - ",
      "GA4 - ",
      "Exception - ",
      "Timer - ",
      "Scroll - ",
      "Click - ",
    ];
    if (!validPrefixes.some((p) => trigger.name.startsWith(p))) {
      issues.push({
        type: "WRONG_TRIGGER_PREFIX",
        triggerId: trigger.triggerId,
        name: trigger.name,
        detail: "Trigger name should start with a standard prefix (e.g., 'CE - ')",
      });
    }
  }

  // Check 8: Duplicate tag names
  for (const [name, ids] of tagNameCounts) {
    if (ids.length > 1) {
      issues.push({
        type: "DUPLICATE_NAME",
        name,
        detail: `Duplicate tag name — found ${ids.length} tags with this name (IDs: ${ids.join(", ")})`,
      });
    }
  }

  // Check 9: Unused variables
  const allContent = JSON.stringify([...tags, ...triggers, ...variables]);
  for (const variable of variables) {
    // Only flag if the variable name is never referenced anywhere in {{...}}
    if (!allContent.includes(`{{${variable.name}}}`)) {
      issues.push({
        type: "UNUSED_VARIABLE",
        variableId: variable.variableId,
        name: variable.name,
        detail: "Variable is never referenced explicitly in any tag, trigger, or variable JSON.",
      });
    } else {
      // If used, enforce naming convention
      const validPrefixes = [
        "DLV - ",
        "JS - ",
        "CJS - ",
        "Constant - ",
        "RegEx - ",
        "Lookup - ",
        "Event - ",
        "URL - ",
        "DOM - ",
      ];
      if (!validPrefixes.some((p) => variable.name.startsWith(p))) {
        issues.push({
          type: "WRONG_VARIABLE_PREFIX",
          variableId: variable.variableId,
          name: variable.name,
          detail: "Variable name should start with a standard prefix (e.g., 'DLV - ', 'JS - ')",
        });
      }
    }
  }

  // Check 9: Exact duplicates
  for (const [hash, group] of tagHashes) {
    if (group.length > 1) {
      issues.push({
        type: "EXACT_DUPLICATE",
        name: group[0].name,
        detail: `Tag does exactly the same thing as ${group.length - 1} other tag(s): ${group
          .slice(1)
          .map((g) => g.name)
          .join(", ")}`,
      });
    }
  }

  // Check 10: Folder organization
  const allResources = [...tags, ...triggers, ...variables];
  const inFolders = allResources.filter((r: any) => r.parentFolderId).length;
  const folderPct =
    allResources.length > 0 ? Math.round((inFolders / allResources.length) * 100) : 100;
  if (folderPct < 50 && allResources.length > 10) {
    issues.push({
      type: "LOW_FOLDER_USAGE",
      name: "Container Organization",
      detail: `Only ${folderPct}% of resources (${inFolders}/${allResources.length}) are organized into folders. Aim for 50%+.`,
    });
  }

  // Paused tags
  const pausedTags = tags.filter((t) => t.paused).map((t) => ({ id: t.tagId, name: t.name }));

  return {
    totalTags: tags.length,
    totalTriggers: triggers.length,
    issues,
    pausedTags,
  };
}

function checkAdVendorConsent(tag: GtmTag, issues: AuditIssue[]): void {
  const consent = tag.consentSettings;
  const consentValues = consent?.consentType?.list?.map((c) => c.value) ?? [];

  if (consent?.consentStatus !== "needed") {
    issues.push({
      type: "CONSENT_NOT_SET",
      tagId: tag.tagId,
      name: tag.name,
      detail: "Ad vendor tag: consent not set to 'needed'",
    });
  } else if (consentValues.includes("analytics_storage") && !consentValues.includes("ad_storage")) {
    issues.push({
      type: "WRONG_CONSENT",
      tagId: tag.tagId,
      name: tag.name,
      detail: "Uses analytics_storage — should be ad_storage for advertising tags",
    });
  }
}

function checkLightweightPixelConsent(tag: GtmTag, issues: AuditIssue[]): void {
  const consent = tag.consentSettings;
  // Lightweight pixels only need ad_storage — don't require ad_user_data/ad_personalization
  if (consent?.consentStatus !== "needed") {
    issues.push({
      type: "CONSENT_NOT_SET",
      tagId: tag.tagId,
      name: tag.name,
      detail: "Lightweight pixel tag: consent not set to 'needed' (requires ad_storage)",
    });
  }
}

function checkMetaEventId(tag: GtmTag, issues: AuditIssue[]): void {
  const htmlParam = tag.parameter?.find((p) => p.key === "html");
  if (!htmlParam?.value) return;

  const html = htmlParam.value;
  if (!html.includes("eventID") && !html.includes("event_id")) {
    issues.push({
      type: "MISSING_EVENT_ID",
      tagId: tag.tagId,
      name: tag.name,
      detail: "Missing eventID — Meta deduplication will be broken",
    });
  }
}

function checkCustomHtmlSecurity(tag: GtmTag, issues: AuditIssue[]): void {
  const htmlParam = tag.parameter?.find((p) => p.key === "html");
  if (!htmlParam?.value) return;

  const html = htmlParam.value;
  for (const { pattern, label } of RISKY_HTML_PATTERNS) {
    if (pattern.test(html)) {
      issues.push({
        type: "CUSTOM_HTML_RISK",
        tagId: tag.tagId,
        name: tag.name,
        detail: `Custom HTML contains risky pattern: ${label} — potential security/injection risk`,
      });
    }
  }
}

function checkMissingVariables(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variableNames: Set<string>,
  issues: AuditIssue[],
): void {
  const varRegex = /\{\{([^}]+)\}\}/g;

  const checkStrings = (obj: any, sourceName: string, id: string, isTag: boolean) => {
    const str = JSON.stringify(obj);
    if (!str) return;
    let match;
    while ((match = varRegex.exec(str)) !== null) {
      const varName = match[1];
      // Skip built-in variables that might not be in the list but are always available
      const builtins = new Set(["Page Path", "Page URL", "Page Hostname", "Referrer", "Event"]);
      if (!variableNames.has(varName) && !builtins.has(varName)) {
        issues.push({
          type: "MISSING_VARIABLE_REF",
          tagId: isTag ? id : undefined,
          triggerId: !isTag ? id : undefined,
          name: sourceName,
          detail: `References missing variable: {{${varName}}}`,
        });
      }
    }
  };

  for (const tag of tags) {
    if (tag.paused) continue;
    checkStrings(tag.parameter, tag.name, tag.tagId, true);
  }

  for (const trigger of triggers) {
    checkStrings(trigger.filter, trigger.name, trigger.triggerId, false);
    checkStrings(trigger.customEventFilter, trigger.name, trigger.triggerId, false);
  }
}

function checkDocumentWrite(tag: GtmTag, issues: AuditIssue[]): void {
  const docWriteParam = tag.parameter?.find((p) => p.key === "supportDocumentWrite");
  if (docWriteParam?.value === "true") {
    issues.push({
      type: "DOC_WRITE_ENABLED",
      tagId: tag.tagId,
      name: tag.name,
      detail: "supportDocumentWrite is enabled — security/performance risk",
    });
  }
}

/**
 * Print a formatted audit report to the console.
 */
export function printAuditReport(report: AuditReport): void {
  console.log(chalk.bold("\n=== GTM Workspace Audit ===\n"));

  // Missing triggers
  console.log(chalk.underline("Tags Missing Triggers"));
  const noTriggers = report.issues.filter(
    (i) => i.type === "NO_TRIGGERS" && i.detail?.includes("no firing triggers"),
  );
  if (noTriggers.length > 0) {
    for (const issue of noTriggers) {
      console.log(`  ${chalk.red("✖")} Tag ${issue.tagId}: ${issue.name} — NO TRIGGERS`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} All tags have at least one trigger`);
  }

  // Ad vendor consent (expanded)
  console.log(chalk.underline("\nAdvertising Tag Consent Settings"));
  const consentIssues = report.issues.filter(
    (i) => i.type === "WRONG_CONSENT" || i.type === "CONSENT_NOT_SET",
  );
  if (consentIssues.length > 0) {
    for (const issue of consentIssues) {
      const icon = issue.type === "WRONG_CONSENT" ? chalk.red("✖") : chalk.yellow("⚠");
      console.log(`  ${icon} Tag ${issue.tagId}: ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} All advertising tags have correct consent settings`);
  }

  // Missing eventID
  console.log(chalk.underline("\nMeta Tags eventID Check"));
  const eventIdIssues = report.issues.filter((i) => i.type === "MISSING_EVENT_ID");
  if (eventIdIssues.length > 0) {
    for (const issue of eventIdIssues) {
      console.log(`  ${chalk.yellow("⚠")} Tag ${issue.tagId}: ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} All Meta HTML tags have eventID`);
  }

  // Orphaned triggers
  console.log(chalk.underline("\nOrphaned Triggers"));
  const orphaned = report.issues.filter((i) => i.type === "ORPHANED_TRIGGER");
  if (orphaned.length > 0) {
    for (const issue of orphaned) {
      console.log(
        `  ${chalk.yellow("⚠")} Trigger ${issue.triggerId}: ${issue.name} — not used by any tag`,
      );
    }
  } else {
    console.log(`  ${chalk.green("✔")} All triggers are used by at least one tag`);
  }

  // Unlimited firing (SPA risk)
  console.log(chalk.underline("\nSPA Firing Safety"));
  const unlimitedFiring = report.issues.filter((i) => i.type === "UNLIMITED_FIRING");
  if (unlimitedFiring.length > 0) {
    for (const issue of unlimitedFiring) {
      console.log(`  ${chalk.yellow("⚠")} Tag ${issue.tagId}: ${issue.name} — unlimited firing`);
    }
    console.log(chalk.gray(`\n  Fix with: tagops fix-firing --dry-run`));
  } else {
    console.log(`  ${chalk.green("✔")} All tags have proper firing options (no SPA duplicates)`);
  }

  // Missing variable references
  console.log(chalk.underline("\nVariable References"));
  const missingVars = report.issues.filter((i) => i.type === "MISSING_VARIABLE_REF");
  if (missingVars.length > 0) {
    for (const issue of missingVars) {
      console.log(`  ${chalk.red("✖")} ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} All variable references are valid`);
  }

  // Unused variables
  console.log(chalk.underline("\nUnused Variables"));
  const unusedVars = report.issues.filter((i) => i.type === "UNUSED_VARIABLE");
  if (unusedVars.length > 0) {
    for (const issue of unusedVars) {
      console.log(
        `  ${chalk.yellow("⚠")} Variable ${issue.variableId}: ${issue.name} — not referenced anywhere`,
      );
    }
  } else {
    console.log(`  ${chalk.green("✔")} All variables are used`);
  }

  // Exact Duplicate Tags
  console.log(chalk.underline("\nExact Duplicate Tags"));
  const exactDups = report.issues.filter((i) => i.type === "EXACT_DUPLICATE");
  if (exactDups.length > 0) {
    for (const issue of exactDups) {
      console.log(`  ${chalk.red("✖")} Tag: ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} No identically configured tags found`);
  }

  // Naming Conventions
  console.log(chalk.underline("\nNaming Conventions"));
  const namingIssues = report.issues.filter((i) =>
    ["BAD_NAMING_CONVENTION", "WRONG_TRIGGER_PREFIX", "WRONG_VARIABLE_PREFIX"].includes(i.type),
  );
  if (namingIssues.length > 0) {
    for (const issue of namingIssues) {
      console.log(`  ${chalk.yellow("⚠")} ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(
      `  ${chalk.green("✔")} All tags, triggers, and variables follow exact naming conventions`,
    );
  }

  // GA4 Validations
  console.log(chalk.underline("\nGA4 E-commerce Schema"));
  const ga4Issues = report.issues.filter((i) => i.type === "GA4_MISSING_PARAMS");
  if (ga4Issues.length > 0) {
    for (const issue of ga4Issues) {
      console.log(`  ${chalk.red("✖")} Tag ${issue.tagId}: ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} All GA4 tags met schema requirements`);
  }

  // Custom HTML Security
  console.log(chalk.underline("\nCustom HTML Security Scan"));
  const securityIssues = report.issues.filter((i) => i.type === "CUSTOM_HTML_RISK");
  if (securityIssues.length > 0) {
    for (const issue of securityIssues) {
      console.log(`  ${chalk.red("✖")} Tag ${issue.tagId}: ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} No risky patterns detected in Custom HTML tags`);
  }

  // Folder Organization
  console.log(chalk.underline("\nFolder Organization"));
  const folderIssues = report.issues.filter((i) => i.type === "LOW_FOLDER_USAGE");
  if (folderIssues.length > 0) {
    for (const issue of folderIssues) {
      console.log(`  ${chalk.yellow("⚠")} ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} Resources are well-organized into folders`);
  }

  // Paused tags
  console.log(chalk.underline("\nPaused Tags"));
  if (report.pausedTags.length > 0) {
    for (const tag of report.pausedTags) {
      console.log(`  ${chalk.gray("⏸")} Tag ${tag.id}: ${tag.name} — PAUSED`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} No paused tags`);
  }

  // Summary
  const issueCount = report.issues.length;
  console.log(chalk.bold(`\n=== Audit Complete: ${issueCount} issue(s) found ===`));
  if (issueCount > 0) {
    for (let i = 0; i < report.issues.length; i++) {
      const issue = report.issues[i];
      console.log(`  ${i + 1}. ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("🎉")} Everything looks good!`);
  }
}

/**
 * Run interactive prompts to clean up the container natively.
 */
export async function runInteractiveFix(report: AuditReport): Promise<void> {
  await requireWriteAccess();

  console.log(chalk.bold("\n=== Interactive Auto-Fix ==="));

  const unusedVars = report.issues.filter((i) => i.type === "UNUSED_VARIABLE");
  if (unusedVars.length > 0) {
    const doDelete = await confirm({
      message: `Found ${unusedVars.length} unused variables. Delete them from GTM?`,
      default: false,
    });
    if (doDelete) {
      for (const v of unusedVars) {
        if (v.variableId) {
          process.stdout.write(`  Deleting variable ${v.name}... `);
          await deleteVariable(v.variableId);
          console.log(chalk.green("Done"));
        }
      }
    }
  }

  const orphanedTriggers = report.issues.filter((i) => i.type === "ORPHANED_TRIGGER");
  if (orphanedTriggers.length > 0) {
    const doDelete = await confirm({
      message: `Found ${orphanedTriggers.length} orphaned triggers. Delete them from GTM?`,
      default: false,
    });
    if (doDelete) {
      for (const t of orphanedTriggers) {
        if (t.triggerId) {
          process.stdout.write(`  Deleting trigger ${t.name}... `);
          await deleteTrigger(t.triggerId);
          console.log(chalk.green("Done"));
        }
      }
    }
  }

  const unlimitedTags = report.issues.filter((i) => i.type === "UNLIMITED_FIRING");
  if (unlimitedTags.length > 0) {
    console.log(chalk.yellow(`\n⚠ Found ${unlimitedTags.length} tags with unlimited firing.`));
    console.log(`  To fix these automatically, run: ${chalk.bold.cyan("tagops fix-firing")}`);
  }

  const exactDups = report.issues.filter((i) => i.type === "EXACT_DUPLICATE");
  if (exactDups.length > 0) {
    console.log(chalk.yellow(`\n⚠ Found ${exactDups.length} exact duplicate tag configurations.`));
    console.log(`  Please review and delete duplicates manually in the GTM UI.`);
  }

  console.log(chalk.green("\n✔ Interactive fix complete. Check your GTM draft workspace."));
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  auditWorkspace()
    .then((report) => {
      console.log(JSON.stringify(report, null, 2));
    })
    .catch((err) => {
      console.error(getSafeErrorMessage(err));
      process.exit(1);
    });
}
