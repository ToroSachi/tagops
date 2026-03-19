/**
 * GTM Workspace Cleanup Utility
 *
 * Checks for:
 *   - Unused variables (not referenced in any tag, trigger, or other variable)
 *   - Orphaned triggers (not used by any tag)
 *   - Paused tags (candidates for true deletion)
 *
 * Usage:
 *   npx tsx src/cli.ts cleanup
 */

import chalk from "chalk";
import { createInterface } from "node:readline/promises";
import {
  listTags,
  listTriggers,
  listVariables,
  deleteTag,
  deleteTrigger,
  deleteVariable,
} from "../lib/gtm-cli.js";
import { BUILTIN_TRIGGER_IDS } from "../lib/architecture.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface CleanupReport {
  unusedVariables: GtmVariable[];
  orphanedTriggers: GtmTrigger[];
  pausedTags: GtmTag[];
}

/**
 * Scan the workspace and return lists of unused resources.
 */
export async function scanForCleanup(): Promise<CleanupReport> {
  const tags = await listTags();
  const triggers = await listTriggers();
  const variables = await listVariables();

  if (tags.length === 0 && triggers.length === 0 && variables.length === 0) {
    throw new Error("Cannot connect to GTM or workspace is completely empty.");
  }

  // 1. Find unused triggers
  const usedTriggerIds = new Set<string>();
  for (const tag of tags) {
    for (const tid of tag.firingTriggerId || []) usedTriggerIds.add(tid);
    for (const tid of tag.blockingTriggerId || []) usedTriggerIds.add(tid);
  }

  const orphanedTriggers = triggers.filter(
    (t) => !usedTriggerIds.has(t.triggerId) && !BUILTIN_TRIGGER_IDS.has(t.triggerId),
  );

  // 2. Find paused tags
  const pausedTags = tags.filter((t) => t.paused);

  // 3. Find unused variables
  // A variable is considered used if its name appears as {{VariableName}} in any tag, trigger, or other variable's definition.
  // Using JSON.stringify makes this robust against nested parameter maps.
  const tagsJson = JSON.stringify(tags);
  const triggersJson = JSON.stringify(triggers);

  const unusedVariables = variables.filter((v) => {
    // Built-in variables in GTM API usually don't have variableId or have specific types,
    // but user variables always do. We'll search for exact variable references.
    const searchString = `{{${v.name}}}`;

    // Check tags
    if (tagsJson.includes(searchString)) return false;

    // Check triggers
    if (triggersJson.includes(searchString)) return false;

    // Check other variables (some variables reference other variables)
    const otherVarsJson = JSON.stringify(
      variables.filter((other) => other.variableId !== v.variableId),
    );
    if (otherVarsJson.includes(searchString)) return false;

    return true;
  });

  return {
    unusedVariables,
    orphanedTriggers,
    pausedTags,
  };
}

/**
 * Interactive prompt to confirm deletion of unused resources.
 */
export async function runInteractiveCleanup(report: CleanupReport): Promise<void> {
  const { unusedVariables, orphanedTriggers, pausedTags } = report;

  console.log(chalk.bold("\n=== GTM Workspace Cleanup ===\n"));

  const total = unusedVariables.length + orphanedTriggers.length + pausedTags.length;
  if (total === 0) {
    console.log(
      chalk.green(
        "✨ Your workspace is clean! No paused tags, orphaned triggers, or unused variables found.\n",
      ),
    );
    return;
  }

  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    // Paused Tags
    if (pausedTags.length > 0) {
      console.log(chalk.yellow(`Found ${pausedTags.length} Paused Tags:`));
      pausedTags.forEach((t) => console.log(`  - ${t.name} (ID: ${t.tagId})`));

      const answer = await rl.question(chalk.yellow("\nDelete all paused tags? [y/N]: "));
      if (answer.toLowerCase() === "y") {
        let deleted = 0;
        for (const tag of pausedTags) {
          if (await deleteTag(tag.tagId)) {
            console.log(chalk.green(`  ✔ Deleted tag: ${tag.name}`));
            deleted++;
          } else {
            console.log(chalk.red(`  ✖ Failed to delete tag: ${tag.name}`));
          }
        }
        console.log(chalk.green(`Deleted ${deleted}/${pausedTags.length} tags.\n`));
      } else {
        console.log("Skipping paused tags.\n");
      }
    }

    // Orphaned Triggers
    if (orphanedTriggers.length > 0) {
      console.log(chalk.yellow(`Found ${orphanedTriggers.length} Orphaned Triggers:`));
      orphanedTriggers.forEach((t) => console.log(`  - ${t.name} (ID: ${t.triggerId})`));

      const answer = await rl.question(chalk.yellow("\nDelete all orphaned triggers? [y/N]: "));
      if (answer.toLowerCase() === "y") {
        let deleted = 0;
        for (const trigger of orphanedTriggers) {
          if (await deleteTrigger(trigger.triggerId)) {
            console.log(chalk.green(`  ✔ Deleted trigger: ${trigger.name}`));
            deleted++;
          } else {
            console.log(chalk.red(`  ✖ Failed to delete trigger: ${trigger.name}`));
          }
        }
        console.log(chalk.green(`Deleted ${deleted}/${orphanedTriggers.length} triggers.\n`));
      } else {
        console.log("Skipping orphaned triggers.\n");
      }
    }

    // Unused Variables
    if (unusedVariables.length > 0) {
      console.log(chalk.yellow(`Found ${unusedVariables.length} Unused Variables:`));
      unusedVariables.forEach((v) => console.log(`  - ${v.name} (ID: ${v.variableId})`));

      const answer = await rl.question(chalk.yellow("\nDelete all unused variables? [y/N]: "));
      if (answer.toLowerCase() === "y") {
        let deleted = 0;
        for (const v of unusedVariables) {
          if (await deleteVariable(v.variableId)) {
            console.log(chalk.green(`  ✔ Deleted variable: ${v.name}`));
            deleted++;
          } else {
            console.log(chalk.red(`  ✖ Failed to delete variable: ${v.name}`));
          }
        }
        console.log(chalk.green(`Deleted ${deleted}/${unusedVariables.length} variables.\n`));
      } else {
        console.log("Skipping unused variables.\n");
      }
    }
  } finally {
    rl.close();
  }

  console.log(chalk.bold("\nCleanup operation complete! 🎉\n"));
}

export function printCleanupReport(report: CleanupReport): void {
  console.log(chalk.bold("\n=== GTM Cleanup Scan ===\n"));

  if (report.pausedTags.length > 0) {
    console.log(chalk.underline(`Paused Tags (${report.pausedTags.length}):`));
    report.pausedTags.forEach((t) => console.log(`  - ${t.name} (ID: ${t.tagId})`));
    console.log("");
  }

  if (report.orphanedTriggers.length > 0) {
    console.log(chalk.underline(`Orphaned Triggers (${report.orphanedTriggers.length}):`));
    report.orphanedTriggers.forEach((t) => console.log(`  - ${t.name} (ID: ${t.triggerId})`));
    console.log("");
  }

  if (report.unusedVariables.length > 0) {
    console.log(chalk.underline(`Unused Variables (${report.unusedVariables.length}):`));
    report.unusedVariables.forEach((v) => console.log(`  - ${v.name} (ID: ${v.variableId})`));
    console.log("");
  }

  const total =
    report.pausedTags.length + report.orphanedTriggers.length + report.unusedVariables.length;
  if (total === 0) {
    console.log(chalk.green("✨ Workspace is completely clean!"));
  } else {
    console.log(chalk.yellow(`Run 'tagops cleanup' to enter interactive deletion wizard.`));
  }
}

// Allow direct execution parsing
if (import.meta.url === `file://${process.argv[1]}`) {
  scanForCleanup()
    .then((report) => {
      if (process.argv.includes("--json")) {
        console.log(JSON.stringify(report, null, 2));
      } else if (process.argv.includes("--scan-only")) {
        printCleanupReport(report);
      } else {
        return runInteractiveCleanup(report);
      }
    })
    .catch((err) => {
      console.error(chalk.red(`\n✖ ${(err as Error).message}`));
      process.exit(1);
    });
}
