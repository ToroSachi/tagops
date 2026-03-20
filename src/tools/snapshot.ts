/**
 * Snapshot — save the full workspace state as a single JSON file.
 *
 * This is the "infrastructure-as-code" foundation. The snapshot captures
 * tags, triggers, variables, folders, built-in variables, and environments
 * so you can diff, restore, or version-control your GTM configuration.
 *
 * Usage:
 *   npx tsx src/cli.ts snapshot [--output gtm-snapshot.json]
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  listBuiltInVariables,
  listEnvironments,
  listFolders,
  listTags,
  listTriggers,
  listVariables,
} from "../lib/gtm-cli.js";
import { loadConfig } from "../lib/config.js";
import { SnapshotData } from "../types/schemas.js";

export type GtmSnapshot = SnapshotData;

export interface SnapshotResult {
  path: string;
  tagCount: number;
  triggerCount: number;
  variableCount: number;
  folderCount: number;
  builtInVariableCount: number;
  environmentCount: number;
  timestamp: string;
}

export async function createSnapshot(): Promise<GtmSnapshot> {
  const config = loadConfig();
  const [tags, triggers, variables, folders, builtInVariables, environments] = await Promise.all([
    listTags(),
    listTriggers(),
    listVariables(),
    listFolders(),
    listBuiltInVariables(),
    listEnvironments(),
  ]);

  if (
    tags.length === 0 &&
    triggers.length === 0 &&
    variables.length === 0 &&
    folders.length === 0 &&
    builtInVariables.length === 0 &&
    environments.length === 0
  ) {
    throw new Error("Cannot connect to GTM. Run: tagops auth login");
  }

  const timestamp = new Date().toISOString();
  return {
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
    folders: folders as GtmSnapshot["folders"],
    builtInVariables: builtInVariables as GtmSnapshot["builtInVariables"],
    environments: environments as GtmSnapshot["environments"],
  };
}

export async function takeSnapshot(outputPath?: string): Promise<SnapshotResult> {
  const snapshot = await createSnapshot();
  const filePath = resolve(outputPath ?? "gtm-snapshot.json");
  writeFileSync(filePath, JSON.stringify(snapshot, null, 2) + "\n");

  return {
    path: filePath,
    tagCount: snapshot.tags.length,
    triggerCount: snapshot.triggers.length,
    variableCount: snapshot.variables.length,
    folderCount: snapshot.folders?.length ?? 0,
    builtInVariableCount: snapshot.builtInVariables?.length ?? 0,
    environmentCount: snapshot.environments?.length ?? 0,
    timestamp: snapshot.meta.timestamp,
  };
}

export function printSnapshotResult(result: SnapshotResult): void {
  console.log(chalk.bold("\n  GTM Snapshot Saved\n"));
  console.log(`  ${chalk.green("✔")} File:       ${result.path}`);
  console.log(`  ${chalk.green("✔")} Tags:       ${result.tagCount}`);
  console.log(`  ${chalk.green("✔")} Triggers:   ${result.triggerCount}`);
  console.log(`  ${chalk.green("✔")} Variables:  ${result.variableCount}`);
  console.log(`  ${chalk.green("✔")} Folders:    ${result.folderCount}`);
  console.log(`  ${chalk.green("✔")} Built-Ins:  ${result.builtInVariableCount}`);
  console.log(`  ${chalk.green("✔")} Environments: ${result.environmentCount}`);
  console.log(`  ${chalk.green("✔")} Timestamp:  ${result.timestamp}`);
  console.log();
}
