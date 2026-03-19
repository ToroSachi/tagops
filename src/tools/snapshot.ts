/**
 * Snapshot — save the full workspace state as a single JSON file.
 *
 * This is the "infrastructure-as-code" foundation. The snapshot captures
 * every tag, trigger, and variable so you can diff, restore, or version-control
 * your GTM configuration.
 *
 * Usage:
 *   npx tsx src/cli.ts snapshot [--output gtm-snapshot.json]
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import { loadConfig } from "../lib/config.js";
import { SnapshotData } from "../types/schemas.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export type GtmSnapshot = SnapshotData;

export interface SnapshotResult {
  path: string;
  tagCount: number;
  triggerCount: number;
  variableCount: number;
  timestamp: string;
}

export async function takeSnapshot(outputPath?: string): Promise<SnapshotResult> {
  const config = loadConfig();
  const tags = await listTags();
  const triggers = await listTriggers();
  const variables = await listVariables();

  if (tags.length === 0 && triggers.length === 0) {
    throw new Error("Cannot connect to GTM. Run: tagops auth login");
  }

  const timestamp = new Date().toISOString();
  const snapshot: GtmSnapshot = {
    schemaVersion: "1.0",
    meta: {
      timestamp,
      accountId: config.accountId,
      containerId: config.containerId,
      workspaceId: config.workspaceId,
      description: "Auto-generated manual snapshot",
    },
    tags: tags as GtmSnapshot["tags"],
    triggers: triggers as GtmSnapshot["triggers"],
    variables: variables as GtmSnapshot["variables"],
  };

  const filePath = resolve(outputPath ?? "gtm-snapshot.json");
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2) + "\n");

  return {
    path: filePath,
    tagCount: tags.length,
    triggerCount: triggers.length,
    variableCount: variables.length,
    timestamp: snapshot.meta.timestamp,
  };
}

export function printSnapshotResult(result: SnapshotResult): void {
  console.log(chalk.bold("\n  GTM Snapshot Saved\n"));
  console.log(`  ${chalk.green("✔")} File:       ${result.path}`);
  console.log(`  ${chalk.green("✔")} Tags:       ${result.tagCount}`);
  console.log(`  ${chalk.green("✔")} Triggers:   ${result.triggerCount}`);
  console.log(`  ${chalk.green("✔")} Variables:  ${result.variableCount}`);
  console.log(`  ${chalk.green("✔")} Timestamp:  ${result.timestamp}`);
  console.log();
}
