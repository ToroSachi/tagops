/**
 * Fix Firing Options — detect and fix unlimited-firing tags for SPA environments
 *
 * In single-page applications (SPAs) like headless Shopify storefronts,
 * tags with `tagFiringOption` set to "unlimited" (or unset, which defaults
 * to unlimited) fire on every route change and hydration cycle. This causes
 * duplicate conversions, inflated analytics, and wasted ad spend.
 *
 * This tool scans for unlimited-firing tags and sets them to "oncePerEvent"
 * (or a user-specified option like "oncePerLoad").
 */

import chalk from "chalk";
import {
  buildCompleteTagConfig,
  listTags,
  listTriggers,
  updateTag,
  getTag,
} from "../lib/gtm-cli.js";
import {
  ALL_PAGES_TRIGGER_ID,
  CONSENT_INITIALIZATION_TRIGGER_ID,
  INITIALIZATION_TRIGGER_ID,
} from "../lib/architecture.js";
import { tagUsesSpaTrigger } from "../lib/policies.js";
import { getSafeErrorMessage } from "../lib/redaction.js";
import { createPreFixBackup } from "../lib/pre-fix-backup.js";
import { requireWriteAccess } from "../lib/permission-guard.js";
import type { GtmTag, GtmTrigger } from "../types/gtm.js";

export type FiringOption = "oncePerEvent" | "oncePerLoad" | "unlimited";

export interface FiringAuditResult {
  tagId: string;
  name: string;
  type: string;
  currentFiringOption: string;
  triggers: string[];
  paused: boolean;
}

export interface FixFiringResult {
  fixed: number;
  skipped: number;
  errors: number;
  actions: string[];
  flagged: FiringAuditResult[];
}

/**
 * Scan all active tags for unlimited firing options.
 */
export async function scanUnlimitedFiring(): Promise<FiringAuditResult[]> {
  const [tags, triggers] = await Promise.all([listTags(), listTriggers()]);
  return findUnlimitedFiringTags(tags, triggers);
}

/**
 * Pure function: find tags with unlimited firing (no API calls).
 */
export function findUnlimitedFiringTags(
  tags: GtmTag[],
  triggers: GtmTrigger[] = [],
): FiringAuditResult[] {
  const results: FiringAuditResult[] = [];

  for (const tag of tags) {
    if (tag.paused) continue;

    const firingOption = tag.tagFiringOption ?? "unlimited";
    if (firingOption === "unlimited" && tagUsesSpaTrigger(tag, triggers)) {
      results.push({
        tagId: tag.tagId,
        name: tag.name,
        type: tag.type,
        currentFiringOption: firingOption,
        triggers: tag.firingTriggerId ?? [],
        paused: !!tag.paused,
      });
    }
  }

  return results;
}

/**
 * Determine the ideal firing option based on trigger scope and tag purpose.
 * SPA-style triggers should use oncePerEvent.
 * Reserve oncePerLoad for bootstrap/base-loader tags on All Pages or Initialization.
 */
function determineIdealFiringOption(tag: { name: string; triggers: string[] }): FiringOption {
  const nameLower = tag.name.toLowerCase();
  const loadScopedTriggerIds = new Set([
    ALL_PAGES_TRIGGER_ID,
    INITIALIZATION_TRIGGER_ID,
    CONSENT_INITIALIZATION_TRIGGER_ID,
  ]);
  const firesOnlyOnLoadScopedTriggers =
    tag.triggers.length > 0 &&
    tag.triggers.every((triggerId) => loadScopedTriggerIds.has(triggerId));

  const bootstrapPatterns = [
    "base",
    "bootstrap",
    "config",
    "global site",
    "loader",
    "pixel init",
    "base pixel",
  ];
  if (
    firesOnlyOnLoadScopedTriggers &&
    bootstrapPatterns.some((pattern) => nameLower.includes(pattern))
  ) {
    return "oncePerLoad";
  }

  return "oncePerEvent";
}

/**
 * Fix tags with unlimited firing by setting them to the appropriate option.
 * If `option` is provided, it overrides the per-tag logic for all tags.
 */
export async function fixFiring(option?: FiringOption, dryRun = false): Promise<FixFiringResult> {
  if (!dryRun) {
    await requireWriteAccess();
  }

  const flagged = await scanUnlimitedFiring();

  let fixed = 0;
  let skipped = 0;
  let errors = 0;
  const actions: string[] = [];

  for (const item of flagged) {
    // Use explicit override if provided, otherwise determine per-tag
    const targetOption = option ?? determineIdealFiringOption(item);

    if (dryRun) {
      actions.push(
        `[DRY RUN] Would fix "${item.name}" (ID: ${item.tagId}): unlimited → ${targetOption}`,
      );
      fixed++;
      continue;
    }

    // Auto-backup before first real write
    if (fixed === 0 && skipped === 0 && errors === 0) {
      await createPreFixBackup("fix-firing");
    }

    try {
      // Fetch the full tag to get current state and fingerprint
      const fullTag = await getTag(item.tagId);
      if (!fullTag) {
        actions.push(`Skipped "${item.name}" (ID: ${item.tagId}): tag not found`);
        skipped++;
        continue;
      }

      // Build the update — we need to send the full tag body
      const config = buildCompleteTagConfig(fullTag, {
        tagFiringOption: targetOption,
      });

      await updateTag({
        tagId: item.tagId,
        name: fullTag.name,
        fingerprint: fullTag.fingerprint,
        config,
      });

      actions.push(`Fixed "${item.name}" (ID: ${item.tagId}): unlimited → ${targetOption}`);
      fixed++;
    } catch (err) {
      actions.push(`Error fixing "${item.name}" (ID: ${item.tagId}): ${getSafeErrorMessage(err)}`);
      errors++;
    }
  }

  return { fixed, skipped, errors, actions, flagged };
}

/**
 * Print a formatted report of the firing audit/fix results.
 */
export function printFixFiringReport(result: FixFiringResult, dryRun: boolean): void {
  console.log(chalk.bold("\n  SPA Firing Option Audit\n"));

  if (result.flagged.length === 0) {
    console.log(
      chalk.green("  ✔ All tags have proper firing options set. No unlimited-firing tags found.\n"),
    );
    return;
  }

  console.log(
    `  Found ${chalk.yellow(String(result.flagged.length))} tag(s) with unlimited firing:\n`,
  );

  for (const action of result.actions) {
    const icon = action.startsWith("[DRY RUN]")
      ? chalk.yellow("  ⚠")
      : action.startsWith("Error")
        ? chalk.red("  ✖")
        : chalk.green("  ✔");
    console.log(`${icon} ${action}`);
  }

  console.log(
    `\n  ${chalk.bold("Summary")}: ${result.fixed} fixed | ${result.skipped} skipped | ${result.errors} errors`,
  );

  if (dryRun) {
    console.log(chalk.gray(`\n  Run without --dry-run to apply these changes.\n`));
  } else {
    console.log(
      chalk.gray(
        `\n  Changes are in the workspace (not published). Review in GTM before publishing.\n`,
      ),
    );
  }
}
