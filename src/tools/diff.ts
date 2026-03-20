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
import {
  listBuiltInVariables,
  listEnvironments,
  listFolders,
  listTags,
  listTriggers,
  listVariables,
} from "../lib/gtm-cli.js";
import { parseSnapshot } from "../types/schemas.js";
import type { GtmSnapshot } from "./snapshot.js";
import type {
  GtmBuiltInVariable,
  GtmEnvironment,
  GtmFolder,
  GtmTag,
  GtmTrigger,
  GtmVariable,
} from "../types/gtm.js";

type DiffResourceType =
  | "tag"
  | "trigger"
  | "variable"
  | "folder"
  | "builtInVariable"
  | "environment";

export interface DiffEntry {
  type: "added" | "removed" | "modified";
  resourceType: DiffResourceType;
  id: string;
  name: string;
  changes?: string[];
}

export interface ResourceDiff {
  added: DiffEntry[];
  removed: DiffEntry[];
  modified: DiffEntry[];
}

export interface DiffReport {
  snapshotFile: string;
  snapshotTimestamp: string;
  added: DiffEntry[];
  removed: DiffEntry[];
  modified: DiffEntry[];
  folderDiff: ResourceDiff;
  builtInDiff: ResourceDiff;
  environmentDiff: ResourceDiff;
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
    foldersAdded: number;
    foldersRemoved: number;
    foldersModified: number;
    builtInsAdded: number;
    builtInsRemoved: number;
    builtInsModified: number;
    environmentsAdded: number;
    environmentsRemoved: number;
    environmentsModified: number;
  };
}

function loadSnapshot(snapshotPath?: string): { snapshot: GtmSnapshot; path: string } {
  const defaultPath = resolve("gtm-snapshot.json");
  const filePath = snapshotPath ? resolve(snapshotPath) : defaultPath;

  if (!existsSync(filePath)) {
    throw new Error(`Snapshot not found: ${filePath}\nRun 'tagops snapshot' to create one first.`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const snapshot = parseSnapshot(raw) as GtmSnapshot;
  return { snapshot, path: filePath };
}

function omitKeys<T extends object>(item: T, keys: string[]): Record<string, unknown> {
  const clone = { ...(item as Record<string, unknown>) };
  for (const key of keys) {
    delete clone[key];
  }
  return clone;
}

function stripTagOpsId(notes?: string): string | undefined {
  if (!notes) return undefined;
  const withoutId = notes
    .replace(/(?:^|\n)\s*TagOps-ID:\s*[a-f0-9-]+\s*(?=\n|$)/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return withoutId.length > 0 ? withoutId : undefined;
}

function collectChangedFields(
  current: Record<string, unknown>,
  saved: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(saved)]);
  const changes: string[] = [];

  for (const key of keys) {
    if (JSON.stringify(current[key]) !== JSON.stringify(saved[key])) {
      changes.push(key);
    }
  }

  return changes.sort();
}

function diffResources<T extends { name: string }>(
  current: T[],
  saved: T[],
  resourceType: DiffResourceType,
  getIdentityKey: (item: T) => string,
  getDisplayId: (item: T) => string,
  getComparable: (item: T) => Record<string, unknown> = (item) => omitKeys(item, ["fingerprint"]),
): ResourceDiff {
  const added: DiffEntry[] = [];
  const removed: DiffEntry[] = [];
  const modified: DiffEntry[] = [];

  const savedMap = new Map<string, T>();
  for (const item of saved) {
    savedMap.set(getIdentityKey(item), item);
  }

  const currentMap = new Map<string, T>();
  for (const item of current) {
    currentMap.set(getIdentityKey(item), item);
  }

  // Check for added and modified
  for (const item of current) {
    const identityKey = getIdentityKey(item);
    const savedItem = savedMap.get(identityKey);

    if (!savedItem) {
      added.push({
        type: "added",
        resourceType,
        id: getDisplayId(item),
        name: item.name,
      });
    } else {
      const changes = collectChangedFields(getComparable(item), getComparable(savedItem));
      if (changes.length > 0) {
        modified.push({
          type: "modified",
          resourceType,
          id: getDisplayId(item),
          name: item.name,
          changes,
        });
      }
    }
  }

  // Check for removed
  for (const item of saved) {
    const identityKey = getIdentityKey(item);
    if (!currentMap.has(identityKey)) {
      removed.push({
        type: "removed",
        resourceType,
        id: getDisplayId(item),
        name: item.name,
      });
    }
  }

  return { added, removed, modified };
}

function getFolderIdentity(folder: GtmFolder): string {
  return `${folder.folderId}::${folder.name}`;
}

function getEnvironmentIdentity(environment: GtmEnvironment): string {
  return `${environment.environmentId}::${environment.name}`;
}

function getBuiltInIdentity(variable: GtmBuiltInVariable): string {
  return `${variable.name}::${variable.type}`;
}

export async function diffWorkspace(snapshotPath?: string): Promise<DiffReport> {
  const { snapshot, path } = loadSnapshot(snapshotPath);

  const [
    currentTags,
    currentTriggers,
    currentVariables,
    currentFolders,
    currentBuiltIns,
    currentEnvironments,
  ] = await Promise.all([
    listTags(),
    listTriggers(),
    listVariables(),
    listFolders(),
    listBuiltInVariables(),
    listEnvironments(),
  ]);

  if (
    currentTags.length === 0 &&
    currentTriggers.length === 0 &&
    currentVariables.length === 0 &&
    currentFolders.length === 0 &&
    currentBuiltIns.length === 0 &&
    currentEnvironments.length === 0
  ) {
    throw new Error("Cannot connect to GTM. Run: tagops auth login");
  }

  const tagDiff = diffResources(
    currentTags,
    snapshot.tags,
    "tag",
    (tag) => tag.tagId,
    (tag) => tag.tagId,
  );
  const trigDiff = diffResources(
    currentTriggers,
    snapshot.triggers,
    "trigger",
    (trigger) => trigger.triggerId,
    (trigger) => trigger.triggerId,
  );
  const varDiff = diffResources(
    currentVariables,
    snapshot.variables,
    "variable",
    (variable) => variable.variableId,
    (variable) => variable.variableId,
  );
  const folderDiff = diffResources(
    currentFolders,
    snapshot.folders ?? [],
    "folder",
    getFolderIdentity,
    (folder) => folder.folderId,
    (folder) => ({
      notes: stripTagOpsId(folder.notes) ?? null,
    }),
  );
  const builtInDiff = diffResources(
    currentBuiltIns,
    snapshot.builtInVariables ?? [],
    "builtInVariable",
    getBuiltInIdentity,
    getBuiltInIdentity,
    (variable) =>
      omitKeys(variable, ["accountId", "containerId", "workspaceId", "path", "name", "type"]),
  );
  const environmentDiff = diffResources(
    currentEnvironments,
    snapshot.environments ?? [],
    "environment",
    getEnvironmentIdentity,
    (environment) => environment.environmentId,
    (environment) => omitKeys(environment, ["environmentId", "name", "path", "fingerprint"]),
  );

  const allAdded = [
    ...tagDiff.added,
    ...trigDiff.added,
    ...varDiff.added,
    ...folderDiff.added,
    ...builtInDiff.added,
    ...environmentDiff.added,
  ];
  const allRemoved = [
    ...tagDiff.removed,
    ...trigDiff.removed,
    ...varDiff.removed,
    ...folderDiff.removed,
    ...builtInDiff.removed,
    ...environmentDiff.removed,
  ];
  const allModified = [
    ...tagDiff.modified,
    ...trigDiff.modified,
    ...varDiff.modified,
    ...folderDiff.modified,
    ...builtInDiff.modified,
    ...environmentDiff.modified,
  ];

  return {
    snapshotFile: path,
    snapshotTimestamp: snapshot.meta.timestamp,
    added: allAdded,
    removed: allRemoved,
    modified: allModified,
    folderDiff,
    builtInDiff,
    environmentDiff,
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
      foldersAdded: folderDiff.added.length,
      foldersRemoved: folderDiff.removed.length,
      foldersModified: folderDiff.modified.length,
      builtInsAdded: builtInDiff.added.length,
      builtInsRemoved: builtInDiff.removed.length,
      builtInsModified: builtInDiff.modified.length,
      environmentsAdded: environmentDiff.added.length,
      environmentsRemoved: environmentDiff.removed.length,
      environmentsModified: environmentDiff.modified.length,
    },
  };
}

function formatResourceType(resourceType: DiffResourceType): string {
  if (resourceType === "builtInVariable") return "built-in";
  return resourceType;
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
      console.log(
        chalk.green(
          `    + [${formatResourceType(entry.resourceType)}] ${entry.name} (${entry.id})`,
        ),
      );
    }
    console.log();
  }

  // Removed
  if (report.removed.length > 0) {
    console.log(chalk.red.bold(`  - Removed (${report.removed.length})`));
    for (const entry of report.removed) {
      console.log(
        chalk.red(`    - [${formatResourceType(entry.resourceType)}] ${entry.name} (${entry.id})`),
      );
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
          `    ~ [${formatResourceType(entry.resourceType)}] ${entry.name} (${entry.id}) — changed: ${fields}`,
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
  console.log(
    `    Folders:   ${chalk.green(`+${s.foldersAdded}`)} ${chalk.red(`-${s.foldersRemoved}`)} ${chalk.yellow(`~${s.foldersModified}`)}`,
  );
  console.log(
    `    Built-Ins: ${chalk.green(`+${s.builtInsAdded}`)} ${chalk.red(`-${s.builtInsRemoved}`)} ${chalk.yellow(`~${s.builtInsModified}`)}`,
  );
  console.log(
    `    Envs:      ${chalk.green(`+${s.environmentsAdded}`)} ${chalk.red(`-${s.environmentsRemoved}`)} ${chalk.yellow(`~${s.environmentsModified}`)}`,
  );
  console.log();
}
