/**
 * Diff — compare current workspace state against a snapshot.
 *
 * Shows what tags, triggers, and variables have been added, removed,
 * or modified since the snapshot was taken.
 *
 * Usage:
 *   npx tsx src/cli.ts diff
 *   npx tsx src/cli.ts diff --snapshot backup.json
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import type { GtmSnapshot } from "./snapshot.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface DiffEntry {
  type: "added" | "removed" | "modified";
  resourceType: "tag" | "trigger" | "variable";
  id: string;
  name: string;
  changes?: string[];
}

export interface DiffReport {
  snapshotFile: string;
  snapshotTimestamp: string;
  added: DiffEntry[];
  removed: DiffEntry[];
  modified: DiffEntry[];
  summary: {
    totalChanges: number;
    tagsAdded: number;
    tagsRemoved: number;
    tagsModified: number;
    triggersAdded: number;
    triggersRemoved: number;
    triggersModified: number;
    variablesAdded: number;
    variablesRemoved: number;
    variablesModified: number;
  };
}

function loadSnapshot(snapshotPath?: string): { snapshot: GtmSnapshot; path: string } {
  const defaultPath = resolve("gtm-snapshot.json");
  const filePath = snapshotPath ? resolve(snapshotPath) : defaultPath;

  if (!existsSync(filePath)) {
    throw new Error(`Snapshot not found: ${filePath}\nRun 'tagops snapshot' to create one first.`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const snapshot = JSON.parse(raw) as GtmSnapshot;
  return { snapshot, path: filePath };
}

function diffResources<T extends { name: string }>(
  current: T[],
  saved: T[],
  idKey: keyof T,
  resourceType: "tag" | "trigger" | "variable",
): { added: DiffEntry[]; removed: DiffEntry[]; modified: DiffEntry[] } {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];

  const savedMap = new Map<string, T>();
  for (const item of saved) {
    savedMap.set(String(item[idKey]), item);
  }

  const currentMap = new Map<string, T>();
  for (const item of current) {
    currentMap.set(String(item[idKey]), item);
  }

  // Check for added and modified
  for (const item of current) {
    const id = String(item[idKey]);
    const savedItem = savedMap.get(id);

    if (!savedItem) {
      added.push({ type: "added", resourceType, id, name: item.name });
    } else {
      // Check for modifications by comparing JSON
      const changes: string[] = [];
      for (const key of Object.keys(item) as (keyof T)[]) {
        if (key === "fingerprint") continue; // Always changes
        const currentVal = JSON.stringify(item[key]);
        const savedVal = JSON.stringify(savedItem[key]);
        if (currentVal !== savedVal) {
          changes.push(String(key));
        }
      }
      if (changes.length > 0) {
        modified.push({ type: "modified", resourceType, id, name: item.name, changes });
      }
    }
  }

  // Check for removed
  for (const item of saved) {
    const id = String(item[idKey]);
    if (!currentMap.has(id)) {
      removed.push({ type: "removed", resourceType, id, name: item.name });
    }
  }

  return { added, removed, modified };
}

export async function diffWorkspace(snapshotPath?: string): Promise<DiffReport> {
  const { snapshot, path } = loadSnapshot(snapshotPath);

  const currentTags = await listTags();
  const currentTriggers = await listTriggers();
  const currentVariables = await listVariables();

  if (currentTags.length === 0 && currentTriggers.length === 0) {
    throw new Error("Cannot connect to GTM. Run: tagops auth login");
  }

  const tagDiff = diffResources(currentTags, snapshot.tags, "tagId" as keyof GtmTag, "tag");
  const trigDiff = diffResources(
    currentTriggers,
    snapshot.triggers,
    "triggerId" as keyof GtmTrigger,
    "trigger",
  );
  const varDiff = diffResources(
    currentVariables,
    snapshot.variables,
    "variableId" as keyof GtmVariable,
    "variable",
  );

  const allAdded = [...tagDiff.added, ...trigDiff.added, ...varDiff.added];
  const allRemoved = [...tagDiff.removed, ...trigDiff.removed, ...varDiff.removed];
  const allModified = [...tagDiff.modified, ...trigDiff.modified, ...varDiff.modified];

  return {
    snapshotFile: path,
    snapshotTimestamp: snapshot.meta.timestamp,
    added: allAdded,
    removed: allRemoved,
    modified: allModified,
    summary: {
      totalChanges: allAdded.length + allRemoved.length + allModified.length,
      tagsAdded: tagDiff.added.length,
      tagsRemoved: tagDiff.removed.length,
      tagsModified: tagDiff.modified.length,
      triggersAdded: trigDiff.added.length,
      triggersRemoved: trigDiff.removed.length,
      triggersModified: trigDiff.modified.length,
      variablesAdded: varDiff.added.length,
      variablesRemoved: varDiff.removed.length,
      variablesModified: varDiff.modified.length,
    },
  };
}

export function printDiffReport(report: DiffReport): void {
  console.log(chalk.bold("\n  GTM Workspace Diff\n"));
  console.log(`  Comparing against: ${chalk.gray(report.snapshotFile)}`);
  console.log(`  Snapshot taken:    ${chalk.gray(report.snapshotTimestamp)}\n`);

  if (report.summary.totalChanges === 0) {
    console.log(chalk.green("  ✔ No changes detected — workspace matches snapshot.\n"));
    return;
  }

  // Added
  if (report.added.length > 0) {
    console.log(chalk.green.bold(`  + Added (${report.added.length})`));
    for (const entry of report.added) {
      console.log(chalk.green(`    + [${entry.resourceType}] ${entry.name} (${entry.id})`));
    }
    console.log();
  }

  // Removed
  if (report.removed.length > 0) {
    console.log(chalk.red.bold(`  - Removed (${report.removed.length})`));
    for (const entry of report.removed) {
      console.log(chalk.red(`    - [${entry.resourceType}] ${entry.name} (${entry.id})`));
    }
    console.log();
  }

  // Modified
  if (report.modified.length > 0) {
    console.log(chalk.yellow.bold(`  ~ Modified (${report.modified.length})`));
    for (const entry of report.modified) {
      const fields = entry.changes?.join(", ") ?? "";
      console.log(
        chalk.yellow(
          `    ~ [${entry.resourceType}] ${entry.name} (${entry.id}) — changed: ${fields}`,
        ),
      );
    }
    console.log();
  }

  // Summary
  console.log(chalk.bold("  Summary"));
  const s = report.summary;
  console.log(
    `    Tags:      ${chalk.green(`+${s.tagsAdded}`)} ${chalk.red(`-${s.tagsRemoved}`)} ${chalk.yellow(`~${s.tagsModified}`)}`,
  );
  console.log(
    `    Triggers:  ${chalk.green(`+${s.triggersAdded}`)} ${chalk.red(`-${s.triggersRemoved}`)} ${chalk.yellow(`~${s.triggersModified}`)}`,
  );
  console.log(
    `    Variables: ${chalk.green(`+${s.variablesAdded}`)} ${chalk.red(`-${s.variablesRemoved}`)} ${chalk.yellow(`~${s.variablesModified}`)}`,
  );
  console.log();
}
