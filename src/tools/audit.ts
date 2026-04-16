/**
 * Audit GTM workspace for common misconfigurations.
 *
 * Checks for:
 *   - Tags with no firing triggers (dead tags)
 *   - Advertising tags with wrong consent settings
 *   - Meta tags missing eventID for deduplication
 *   - Tags with supportDocumentWrite enabled (security risk)
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
  verifyGtmConnection,
} from "../lib/gtm-cli.js";
import {
  BUILTIN_TRIGGER_IDS,
  GTM_BUILTIN_VARIABLES,
  VARIABLE_PREFIX_PATTERN,
  TRIGGER_PREFIX_PATTERN,
} from "../lib/architecture.js";
import {
  getMetaTagsMissingEventId,
  getMissingRequiredConsentSignalsForTag,
  getRequiredConsentSignalsForTag,
  tagUsesSpaTrigger,
} from "../lib/policies.js";
import { requireWriteAccess } from "../lib/permission-guard.js";
import type {
  AuditIssue,
  AuditIssueType,
  AuditReport,
  AuditSeverity,
  GtmTag,
  GtmTrigger,
  GtmVariable,
} from "../types/gtm.js";

/** Map each issue type to a severity level */
const SEVERITY_MAP: Record<AuditIssueType, AuditSeverity> = {
  CUSTOM_HTML_RISK: "critical",
  MISSING_SETUP_TAG: "critical",
  NO_TRIGGERS: "high",
  WRONG_CONSENT: "high",
  CONSENT_NOT_SET: "high",
  CONSENT_V2_MISSING_AD_STORAGE: "high",
  CONSENT_V2_MISSING_AD_USER_DATA: "high",
  CONSENT_V2_MISSING_AD_PERSONALIZATION: "high",
  CONSENT_V2_MISSING_ANALYTICS_STORAGE: "high",
  CONSENT_V2_NO_CONSENT_CONFIGURED: "high",
  MISSING_VARIABLE_REF: "high",
  GA4_MISSING_PARAMS: "high",
  EXACT_DUPLICATE: "high",
  ORPHANED_TRIGGER: "medium",
  UNLIMITED_FIRING: "medium",
  DUPLICATE_NAME: "medium",
  DOC_WRITE_ENABLED: "medium",
  MISSING_EVENT_ID: "medium",
  UNUSED_VARIABLE: "low",
  PAUSED_TAG: "low",
  BAD_NAMING_CONVENTION: "low",
  WRONG_VARIABLE_PREFIX: "low",
  WRONG_TRIGGER_PREFIX: "low",
  LOW_FOLDER_USAGE: "low",
};

function pushIssue(issues: AuditIssue[], issue: Omit<AuditIssue, "severity">): void {
  issues.push({ ...issue, severity: SEVERITY_MAP[issue.type] });
}

export interface AuditWorkspaceState {
  tags: GtmTag[];
  triggers: GtmTrigger[];
  variables: GtmVariable[];
}

// Risky patterns in Custom HTML that indicate security/injection risks
const RISKY_HTML_PATTERNS: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /eval\s*\(/i, label: "eval()" },
  { pattern: /document\.cookie/i, label: "document.cookie" },
  { pattern: /\.innerHTML\s*=/i, label: "innerHTML assignment" },
  { pattern: /new\s+Function\s*\(/i, label: "new Function()" },
];

/**
 * Run a full audit and return a structured report.
 * This function is used by both the CLI and MCP server.
 */
export async function auditWorkspace(state?: AuditWorkspaceState): Promise<AuditReport> {
  const [tags, triggers, variables] = state
    ? [state.tags, state.triggers, state.variables]
    : await Promise.all([listTags(), listTriggers(), listVariables()]);

  if (tags.length === 0 && triggers.length === 0 && variables.length === 0) {
    await verifyGtmConnection();
  }

  const issues: AuditIssue[] = [];
  const triggerUsage: Record<string, string[]> = {};

  // Initialize trigger usage tracking
  for (const t of triggers) {
    triggerUsage[t.triggerId] = [];
  }

  // Track tag names for duplicate detection
  const tagNameCounts = new Map<string, string[]>();
  const knownTagNames = new Set(tags.map((tag) => tag.name));

  // Track exact hash configuration for exact duplicate detection
  const tagHashes = new Map<string, Array<{ id: string; name: string }>>();

  // Check each tag
  for (const tag of tags) {
    const firing = tag.firingTriggerId ?? [];

    // Track trigger usage (both firing and blocking)
    for (const tid of firing) {
      if (triggerUsage[tid]) {
        triggerUsage[tid].push(tag.name);
      }
    }
    for (const tid of tag.blockingTriggerId ?? []) {
      if (triggerUsage[tid]) {
        triggerUsage[tid].push(tag.name);
      }
    }

    // Track tag name duplicates
    const existing = tagNameCounts.get(tag.name) ?? [];
    existing.push(tag.tagId);
    tagNameCounts.set(tag.name, existing);

    if (!tag.paused) {
      checkMissingSetupTags(tag, knownTagNames, issues);
    }

    // Check 1: Missing triggers
    if (firing.length === 0 && !tag.paused) {
      pushIssue(issues, {
        type: "NO_TRIGGERS",
        tagId: tag.tagId,
        name: tag.name,
        detail: "Tag has no firing triggers — it will never fire",
      });
    }

    // Check 2: supportDocumentWrite enabled (perf/security risk)
    if (tag.type === "html" && !tag.paused) {
      checkDocumentWrite(tag, issues);
      // Check 2b: Custom HTML security scan
      checkCustomHtmlSecurity(tag, issues);
    }

    // Check 3: Unlimited firing on SPA-style triggers only
    if (!tag.paused) {
      const firingOption = tag.tagFiringOption ?? tag.firingOption ?? "unlimited";
      if (firingOption === "unlimited" && tagUsesSpaTrigger(tag, triggers)) {
        pushIssue(issues, {
          type: "UNLIMITED_FIRING",
          tagId: tag.tagId,
          name: tag.name,
          detail:
            "Tag has unlimited firing on an SPA-style trigger — it may fire on every virtual pageview or route change. Set to oncePerEvent unless this is a bootstrap tag on All Pages or Initialization.",
        });
      }
    } else {
      // It IS paused
      pushIssue(issues, {
        type: "PAUSED_TAG",
        tagId: tag.tagId,
        name: tag.name,
        detail:
          "Tag is paused. Consider deleting it to keep the container clean and reduce payload weight.",
      });
    }

    // Check 4: Tag Naming Convention
    if (!tag.name.includes("-") && !tag.name.includes("–") && !tag.paused && tag.type !== "gaawe") {
      pushIssue(issues, {
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
          pushIssue(issues, {
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
      setup: tag.setupTag,
      teardown: tag.teardownTag,
      priority: tag.priority,
      firingOpt: tag.tagFiringOption ?? tag.firingOption,
      monitoringMetadata: tag.monitoringMetadata,
      monitoringMetadataTagNameKey: tag.monitoringMetadataTagNameKey,
    };
    const hash = crypto.createHash("sha256").update(JSON.stringify(payloadOpts)).digest("hex");
    const existingHashGroup = tagHashes.get(hash) ?? [];
    existingHashGroup.push({ id: tag.tagId, name: tag.name });
    tagHashes.set(hash, existingHashGroup);
  }

  for (const tag of tags) {
    if (tag.paused) {
      continue;
    }

    const requiredSignals = getRequiredConsentSignalsForTag(tag);
    const missingSignals = getMissingRequiredConsentSignalsForTag(tag);
    if (requiredSignals.length === 0 || missingSignals.length === 0) {
      continue;
    }

    const hasExplicitConsent = tag.consentSettings?.consentStatus === "needed";
    pushIssue(issues, {
      type: hasExplicitConsent ? "WRONG_CONSENT" : "CONSENT_NOT_SET",
      tagId: tag.tagId,
      name: tag.name,
      detail: hasExplicitConsent
        ? `Missing consent signals: ${missingSignals.join(", ")}`
        : `Consent not set to 'needed' (requires: ${requiredSignals.join(", ")})`,
    });
  }

  for (const tag of getMetaTagsMissingEventId(tags)) {
    pushIssue(issues, {
      type: "MISSING_EVENT_ID",
      tagId: tag.tagId,
      name: tag.name,
      detail: "Missing eventID — Meta browser/server deduplication will be broken",
    });
  }

  // Check 6: Missing variable references
  const variableNames = new Set(variables.map((v) => v.name));
  checkMissingVariables(tags, triggers, variableNames, issues);

  // Check 7: Orphaned triggers
  for (const [tid, users] of Object.entries(triggerUsage)) {
    if (users.length === 0 && !BUILTIN_TRIGGER_IDS.has(tid)) {
      const trigger = triggers.find((t) => t.triggerId === tid);
      pushIssue(issues, {
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
    if (!TRIGGER_PREFIX_PATTERN.test(trigger.name)) {
      pushIssue(issues, {
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
      pushIssue(issues, {
        type: "DUPLICATE_NAME",
        name,
        detail: `Duplicate tag name — found ${ids.length} tags with this name (IDs: ${ids.join(", ")})`,
      });
    }
  }

  // Check 9: Unused variables — extract all {{...}} refs in one pass, then check membership
  const allContent = JSON.stringify([...tags, ...triggers, ...variables]);
  const referencedVars = new Set<string>();
  const refExtractor = /\{\{([^}]+)\}\}/g;
  let refMatch;
  while ((refMatch = refExtractor.exec(allContent)) !== null) {
    referencedVars.add(refMatch[1]);
  }
  for (const variable of variables) {
    if (!referencedVars.has(variable.name)) {
      pushIssue(issues, {
        type: "UNUSED_VARIABLE",
        variableId: variable.variableId,
        name: variable.name,
        detail: "Variable is never referenced explicitly in any tag, trigger, or variable JSON.",
      });
    } else {
      // If used, enforce naming convention
      if (!VARIABLE_PREFIX_PATTERN.test(variable.name)) {
        pushIssue(issues, {
          type: "WRONG_VARIABLE_PREFIX",
          variableId: variable.variableId,
          name: variable.name,
          detail: "Variable name should start with a standard prefix (e.g., 'DLV - ', 'JS - ')",
        });
      }
    }
  }

  // Check 10: Exact duplicates
  for (const [, group] of tagHashes) {
    if (group.length > 1) {
      pushIssue(issues, {
        type: "EXACT_DUPLICATE",
        name: group[0].name,
        detail: `Tag does exactly the same thing as ${group.length - 1} other tag(s): ${group
          .slice(1)
          .map((g) => g.name)
          .join(", ")}`,
      });
    }
  }

  // Check 11: Folder organization
  const allResources = [...tags, ...triggers, ...variables];
  const inFolders = allResources.filter((r) => r.parentFolderId).length;
  const folderPct =
    allResources.length > 0 ? Math.round((inFolders / allResources.length) * 100) : 100;
  if (folderPct < 50 && allResources.length > 10) {
    pushIssue(issues, {
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

function checkCustomHtmlSecurity(tag: GtmTag, issues: AuditIssue[]): void {
  const htmlParam = tag.parameter?.find((p) => p.key === "html");
  if (!htmlParam?.value) return;

  const html = htmlParam.value;
  for (const { pattern, label } of RISKY_HTML_PATTERNS) {
    if (pattern.test(html)) {
      pushIssue(issues, {
        type: "CUSTOM_HTML_RISK",
        tagId: tag.tagId,
        name: tag.name,
        detail: `Custom HTML contains risky pattern: ${label} — potential security/injection risk`,
      });
    }
  }
}

function checkMissingSetupTags(
  tag: GtmTag,
  knownTagNames: Set<string>,
  issues: AuditIssue[],
): void {
  for (const setupRef of tag.setupTag ?? []) {
    if (knownTagNames.has(setupRef.tagName)) {
      continue;
    }

    pushIssue(issues, {
      type: "MISSING_SETUP_TAG",
      tagId: tag.tagId,
      name: tag.name,
      detail: `References missing setup tag: ${setupRef.tagName}`,
    });
  }
}

function checkMissingVariables(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variableNames: Set<string>,
  issues: AuditIssue[],
): void {
  const checkStrings = (obj: unknown, sourceName: string, id: string, isTag: boolean) => {
    const str = JSON.stringify(obj);
    if (!str) return;
    // Use a fresh regex per call to avoid stale lastIndex from a shared /g regex
    const varRegex = /\{\{([^}]+)\}\}/g;
    let match;
    while ((match = varRegex.exec(str)) !== null) {
      const varName = match[1];
      if (!variableNames.has(varName) && !GTM_BUILTIN_VARIABLES.has(varName)) {
        pushIssue(issues, {
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
    pushIssue(issues, {
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
    console.log(`  ${chalk.green("✔")} All Meta dedup tags have eventID`);
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

  // Missing setup tag references
  console.log(chalk.underline("\nTag Sequencing"));
  const missingSetupTags = report.issues.filter((i) => i.type === "MISSING_SETUP_TAG");
  if (missingSetupTags.length > 0) {
    for (const issue of missingSetupTags) {
      console.log(`  ${chalk.red("✖")} Tag ${issue.tagId}: ${issue.name} — ${issue.detail}`);
    }
  } else {
    console.log(`  ${chalk.green("✔")} All setup tag references resolve to live tags`);
  }

  // Unlimited firing (SPA risk)
  console.log(chalk.underline("\nSPA Firing Safety"));
  const unlimitedFiring = report.issues.filter((i) => i.type === "UNLIMITED_FIRING");
  if (unlimitedFiring.length > 0) {
    for (const issue of unlimitedFiring) {
      console.log(`  ${chalk.yellow("⚠")} Tag ${issue.tagId}: ${issue.name} — unlimited firing`);
    }
    console.log(
      chalk.gray(
        `\n  Review SPA firing in the GTM UI; unlimited firing on history_change duplicates events.`,
      ),
    );
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

  // Summary by severity
  const issueCount = report.issues.length;
  console.log(chalk.bold(`\n=== Audit Complete: ${issueCount} issue(s) found ===`));
  if (issueCount > 0) {
    const critical = report.issues.filter((i) => i.severity === "critical");
    const high = report.issues.filter((i) => i.severity === "high");
    const medium = report.issues.filter((i) => i.severity === "medium");
    const low = report.issues.filter((i) => i.severity === "low");

    const parts: string[] = [];
    if (critical.length) parts.push(chalk.red(`${critical.length} critical`));
    if (high.length) parts.push(chalk.yellow(`${high.length} high`));
    if (medium.length) parts.push(chalk.cyan(`${medium.length} medium`));
    if (low.length) parts.push(chalk.gray(`${low.length} low`));
    console.log(`  ${parts.join("  |  ")}`);

    if (critical.length > 0) {
      console.log(chalk.red(`\n  Critical:`));
      for (const issue of critical) {
        console.log(`    ${chalk.red("✖")} ${issue.name} — ${issue.detail}`);
      }
    }
    if (high.length > 0) {
      console.log(chalk.yellow(`\n  High:`));
      for (const issue of high) {
        console.log(`    ${chalk.yellow("!")} ${issue.name} — ${issue.detail}`);
      }
    }
  } else {
    console.log(`  ${chalk.green("✔")} Everything looks good!`);
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
    console.log(
      `  Review SPA-firing safety in the GTM UI — unlimited firing on history_change duplicates events.`,
    );
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
