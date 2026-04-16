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
import { areResourcesEqual } from "../lib/comparator.js";
import {
  listBuiltInVariables,
  listEnvironments,
  listFolders,
  listTags,
  listTriggers,
  listVariables,
  verifyGtmConnection,
} from "../lib/gtm-cli.js";
import { stripTagOpsId, stripVolatileFields } from "../lib/identity.js";
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

function coerceArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
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

function normalizeComparableResource(
  resource: Record<string, unknown>,
  extraKeys: string[] = [],
): Record<string, unknown> {
  const normalized = stripVolatileFields(resource, extraKeys);

  if (typeof normalized.notes === "string") {
    normalized.notes = stripTagOpsId(normalized.notes) ?? null;
  }

  return normalized;
}

function asComparableRecord<T extends object>(value: T): Record<string, unknown> {
  return value as unknown as Record<string, unknown>;
}

function normalizeComparableTag(tag: GtmTag): Record<string, unknown> {
  const normalized = normalizeComparableResource(asComparableRecord(tag));
  normalized.setupTag = tag.setupTag ?? null;
  normalized.teardownTag = tag.teardownTag ?? null;
  normalized.priority = tag.priority ?? null;
  normalized.tagFiringOption = tag.tagFiringOption ?? tag.firingOption ?? null;
  normalized.monitoringMetadata = tag.monitoringMetadata ?? null;
  normalized.monitoringMetadataTagNameKey = tag.monitoringMetadataTagNameKey ?? null;
  delete normalized.firingOption;
  return normalized;
}

function collectChangedFields(
  current: Record<string, unknown>,
  saved: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(current), ...Object.keys(saved)]);
  const changes: string[] = [];

  for (const key of keys) {
    if (!areResourcesEqual({ [key]: current[key] }, { [key]: saved[key] })) {
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
  getComparable: (item: T) => Record<string, unknown> = (item) =>
    normalizeComparableResource(item as Record<string, unknown>),
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
    loadedTags,
    loadedTriggers,
    loadedVariables,
    loadedFolders,
    loadedBuiltIns,
    loadedEnvironments,
  ] = await Promise.all([
    listTags(),
    listTriggers(),
    listVariables(),
    listFolders(),
    listBuiltInVariables(),
    listEnvironments(),
  ]);
  const currentTags = coerceArray<GtmTag>(loadedTags);
  const currentTriggers = coerceArray<GtmTrigger>(loadedTriggers);
  const currentVariables = coerceArray<GtmVariable>(loadedVariables);
  const currentFolders = coerceArray<GtmFolder>(loadedFolders);
  const currentBuiltIns = coerceArray<GtmBuiltInVariable>(loadedBuiltIns);
  const currentEnvironments = coerceArray<GtmEnvironment>(loadedEnvironments);

  if (
    currentTags.length === 0 &&
    currentTriggers.length === 0 &&
    currentVariables.length === 0 &&
    currentFolders.length === 0 &&
    currentBuiltIns.length === 0 &&
    currentEnvironments.length === 0
  ) {
    await verifyGtmConnection();
  }

  const tagDiff = diffResources(
    currentTags,
    coerceArray<GtmTag>(snapshot.tags),
    "tag",
    (tag) => tag.tagId,
    (tag) => tag.tagId,
    normalizeComparableTag,
  );
  const trigDiff = diffResources(
    currentTriggers,
    coerceArray<GtmTrigger>(snapshot.triggers),
    "trigger",
    (trigger) => trigger.triggerId,
    (trigger) => trigger.triggerId,
  );
  const varDiff = diffResources(
    currentVariables,
    coerceArray<GtmVariable>(snapshot.variables),
    "variable",
    (variable) => variable.variableId,
    (variable) => variable.variableId,
  );
  const folderDiff = diffResources(
    currentFolders,
    coerceArray<GtmFolder>(snapshot.folders),
    "folder",
    getFolderIdentity,
    (folder) => folder.folderId,
    (folder) => ({
      notes: stripTagOpsId(folder.notes) ?? null,
    }),
  );
  const builtInDiff = diffResources(
    currentBuiltIns,
    coerceArray<GtmBuiltInVariable>(snapshot.builtInVariables),
    "builtInVariable",
    getBuiltInIdentity,
    getBuiltInIdentity,
    (variable) => normalizeComparableResource(asComparableRecord(variable), ["name", "type"]),
  );
  const environmentDiff = diffResources(
    currentEnvironments,
    coerceArray<GtmEnvironment>(snapshot.environments),
    "environment",
    getEnvironmentIdentity,
    (environment) => environment.environmentId,
    (environment) =>
      normalizeComparableResource(asComparableRecord(environment), ["environmentId", "name"]),
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
