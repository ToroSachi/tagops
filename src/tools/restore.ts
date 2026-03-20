/**
 * Restore — restore workspace from a snapshot file.
 *
 * Compares current state vs snapshot and creates/updates resources to match.
 * Supports --dry-run and optional --delete for safety.
 *
 * Usage:
 *   npx tsx src/cli.ts restore gtm-snapshot.json [--dry-run] [--delete]
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  buildCompleteTagConfig,
  listTags,
  listTriggers,
  listVariables,
  createTag,
  updateTag,
  createTrigger,
  updateTrigger,
  createVariable,
  updateVariable,
  deleteTag,
  deleteTrigger,
  deleteVariable,
} from "../lib/gtm-cli.js";
import { BUILTIN_TRIGGER_IDS } from "../lib/architecture.js";
import { parseSnapshot } from "../types/schemas.js";
import type { GtmSnapshot } from "./snapshot.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

type RestorableTag = Partial<GtmTag> & {
  notes?: string;
  parameter?: unknown[];
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  consentSettings?: GtmTag["consentSettings"];
  tagFiringOption?: string;
  paused?: boolean;
  parentFolderId?: string;
};

type RestorableTrigger = Partial<GtmTrigger> & {
  notes?: string;
  parameter?: unknown[];
  filter?: unknown[];
  customEventFilter?: unknown[];
  parentFolderId?: string;
};

type RestorableVariable = Partial<GtmVariable> & {
  notes?: string;
  parameter?: unknown[];
  parentFolderId?: string;
};

export interface RestoreAction {
  action: "create" | "update" | "delete" | "skip";
  resourceType: "tag" | "trigger" | "variable";
  id: string;
  name: string;
  detail?: string;
  success?: boolean;
}

export interface RestoreResult {
  snapshotFile: string;
  dryRun: boolean;
  actions: RestoreAction[];
  summary: {
    created: number;
    updated: number;
    deleted: number;
    skipped: number;
    failed: number;
  };
}

export interface RestoreOptions {
  dryRun: boolean;
  allowDelete: boolean;
}

type ResourceKind = "tag" | "trigger" | "variable";

function getTagOpsId(notes?: string): string | undefined {
  if (!notes) return undefined;
  const match = notes.match(/TagOps-ID:\s*([a-f0-9-]+)/i);
  return match?.[1];
}

function stripTagOpsId(notes?: string): string | undefined {
  if (!notes) return undefined;
  const withoutId = notes
    .replace(/(?:^|\n)\s*TagOps-ID:\s*[a-f0-9-]+\s*(?=\n|$)/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return withoutId.length > 0 ? withoutId : undefined;
}

function normalizeStringArray(values?: string[]): string[] | undefined {
  if (!values || values.length === 0) return undefined;
  return [...values].filter(Boolean).sort();
}

function mapTriggerIds(
  ids: string[] | undefined,
  triggerIdMap: Map<string, string>,
): string[] | undefined {
  if (!ids || ids.length === 0) return undefined;
  return ids.map((id) => triggerIdMap.get(id) ?? id);
}

function uniqueById<T extends { name: string }>(
  items: T[],
  getId: (item: T) => string | undefined,
): T[] {
  const seen = new Set<string>();
  const unique: T[] = [];
  for (const item of items) {
    const id = getId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    unique.push(item);
  }
  return unique;
}

function findMatchingResource<T extends { name: string; notes?: string }>(
  snapshotItem: T,
  currentItems: T[],
  idKey: keyof T,
): T | undefined {
  const snapshotTagOpsId = getTagOpsId(snapshotItem.notes);
  if (snapshotTagOpsId) {
    const byTagOpsId = currentItems.find((item) => getTagOpsId(item.notes) === snapshotTagOpsId);
    if (byTagOpsId) return byTagOpsId;
  }

  const snapshotId = snapshotItem[idKey];
  if (typeof snapshotId === "string" && snapshotId.length > 0) {
    const byId = currentItems.find((item) => item[idKey] === snapshotId);
    if (byId) return byId;
  }

  const byName = currentItems.filter((item) => item.name === snapshotItem.name);
  if (byName.length === 1) return byName[0];

  return undefined;
}

function normalizeTag(tag: RestorableTag): Record<string, unknown> {
  return {
    name: tag.name,
    type: tag.type,
    parameter: tag.parameter ?? [],
    firingTriggerId: normalizeStringArray(tag.firingTriggerId),
    blockingTriggerId: normalizeStringArray(tag.blockingTriggerId),
    tagFiringOption: tag.tagFiringOption ?? null,
    paused: tag.paused ?? false,
    consentSettings: tag.consentSettings ?? null,
    parentFolderId: (tag as GtmTag & { parentFolderId?: string }).parentFolderId ?? null,
    notes: stripTagOpsId(tag.notes),
  };
}

function normalizeTagWithTriggerMap(
  tag: RestorableTag,
  triggerIdMap: Map<string, string>,
): Record<string, unknown> {
  return {
    ...normalizeTag(tag),
    firingTriggerId: normalizeStringArray(mapTriggerIds(tag.firingTriggerId, triggerIdMap)),
    blockingTriggerId: normalizeStringArray(mapTriggerIds(tag.blockingTriggerId, triggerIdMap)),
  };
}

function normalizeTrigger(trigger: RestorableTrigger): Record<string, unknown> {
  return {
    name: trigger.name,
    type: trigger.type,
    filter: trigger.filter ?? [],
    customEventFilter: trigger.customEventFilter ?? [],
    parameter: trigger.parameter ?? [],
    parentFolderId: (trigger as GtmTrigger & { parentFolderId?: string }).parentFolderId ?? null,
    notes: stripTagOpsId(trigger.notes),
  };
}

function normalizeVariable(variable: RestorableVariable): Record<string, unknown> {
  return {
    name: variable.name,
    type: variable.type,
    parameter: variable.parameter ?? [],
    parentFolderId: (variable as GtmVariable & { parentFolderId?: string }).parentFolderId ?? null,
    notes: stripTagOpsId(variable.notes),
  };
}

function createTagConfig(
  tag: RestorableTag,
  triggerIdMap: Map<string, string>,
  current?: RestorableTag,
): Record<string, unknown> {
  const notes = tag.notes ?? current?.notes;
  const config: Record<string, unknown> = {
    parameter: tag.parameter ?? [],
    consentSettings: tag.consentSettings,
    paused: tag.paused,
    tagFiringOption: tag.tagFiringOption,
    parentFolderId: tag.parentFolderId,
    notes,
  };

  const firingTriggerId = mapTriggerIds(tag.firingTriggerId, triggerIdMap);
  const blockingTriggerId = mapTriggerIds(tag.blockingTriggerId, triggerIdMap);

  if (firingTriggerId?.length) {
    config.firingTriggerId = firingTriggerId;
  }

  if (blockingTriggerId?.length) {
    config.blockingTriggerId = blockingTriggerId;
  }

  return config;
}

function updateTagConfig(
  tag: RestorableTag,
  triggerIdMap: Map<string, string>,
  current?: RestorableTag,
): Record<string, unknown> {
  const firingTriggerId = mapTriggerIds(tag.firingTriggerId, triggerIdMap);
  const blockingTriggerId = mapTriggerIds(tag.blockingTriggerId, triggerIdMap);

  return buildCompleteTagConfig(tag, {
    parentFolderId: tag.parentFolderId,
    notes: tag.notes ?? current?.notes,
    firingTriggerId,
    blockingTriggerId,
  });
}

function createTriggerConfig(
  trigger: RestorableTrigger,
  current?: RestorableTrigger,
): Record<string, unknown> {
  return {
    customEventFilter: trigger.customEventFilter,
    filter: trigger.filter,
    parameter: trigger.parameter ?? [],
    parentFolderId: trigger.parentFolderId,
    notes: trigger.notes ?? current?.notes,
  };
}

function updateTriggerConfig(
  trigger: RestorableTrigger,
  current?: RestorableTrigger,
): Record<string, unknown> {
  return {
    type: trigger.type,
    customEventFilter: trigger.customEventFilter,
    filter: trigger.filter,
    parameter: trigger.parameter ?? [],
    parentFolderId: trigger.parentFolderId,
    notes: trigger.notes ?? current?.notes,
  };
}

function createVariableConfig(
  variable: RestorableVariable,
  current?: RestorableVariable,
): Record<string, unknown> {
  return {
    parameter: variable.parameter ?? [],
    parentFolderId: variable.parentFolderId,
    notes: variable.notes ?? current?.notes,
  };
}

function updateVariableConfig(
  variable: RestorableVariable,
  current?: RestorableVariable,
): Record<string, unknown> {
  return {
    type: variable.type,
    parameter: variable.parameter ?? [],
    parentFolderId: variable.parentFolderId,
    notes: variable.notes ?? current?.notes,
  };
}

function isEquivalent(a: Record<string, unknown>, b: Record<string, unknown>): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sortActions(actions: RestoreAction[]): RestoreAction[] {
  return actions;
}

function resolveSnapshotIdentity<T extends { name: string; notes?: string }>(
  snapshotItem: T,
  currentItems: T[],
  idKey: keyof T,
): T | undefined {
  return findMatchingResource(snapshotItem, currentItems, idKey);
}

async function restoreTags(
  snapshotTags: GtmTag[],
  currentTags: GtmTag[],
  triggerIdMap: Map<string, string>,
  dryRun: boolean,
  actions: RestoreAction[],
  keepTagIds: Set<string>,
): Promise<{ created: number; updated: number; skipped: number; failed: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const snapshotTag of snapshotTags) {
    const currentTag = resolveSnapshotIdentity(snapshotTag, currentTags, "tagId");
    if (!currentTag) {
      if (dryRun) {
        actions.push({
          action: "create",
          resourceType: "tag",
          id: snapshotTag.tagId,
          name: snapshotTag.name,
          detail: "Would create",
        });
        created++;
      } else {
        const result = await createTag({
          name: snapshotTag.name,
          type: snapshotTag.type,
          firingTriggerId: mapTriggerIds(snapshotTag.firingTriggerId, triggerIdMap) ?? [],
          config: createTagConfig(snapshotTag, triggerIdMap),
        });
        if (result) {
          actions.push({
            action: "create",
            resourceType: "tag",
            id: snapshotTag.tagId,
            name: snapshotTag.name,
            success: true,
          });
          created++;
        } else {
          actions.push({
            action: "create",
            resourceType: "tag",
            id: snapshotTag.tagId,
            name: snapshotTag.name,
            success: false,
          });
          failed++;
        }
      }
      continue;
    }

    keepTagIds.add(currentTag.tagId);
    const currentComparable = normalizeTag(currentTag);
    const snapshotComparable = normalizeTagWithTriggerMap(snapshotTag, triggerIdMap);

    if (isEquivalent(currentComparable, snapshotComparable)) {
      actions.push({
        action: "skip",
        resourceType: "tag",
        id: currentTag.tagId,
        name: snapshotTag.name,
        detail: "Already matches snapshot",
      });
      skipped++;
      continue;
    }

    if (dryRun) {
      actions.push({
        action: "update",
        resourceType: "tag",
        id: currentTag.tagId,
        name: snapshotTag.name,
        detail: "Would update",
      });
      updated++;
      continue;
    }

    try {
      await updateTag({
        tagId: currentTag.tagId,
        name: snapshotTag.name,
        fingerprint: currentTag.fingerprint,
        firingTriggerId: mapTriggerIds(snapshotTag.firingTriggerId, triggerIdMap) ?? [],
        config: updateTagConfig(snapshotTag, triggerIdMap, currentTag),
      });
      actions.push({
        action: "update",
        resourceType: "tag",
        id: currentTag.tagId,
        name: snapshotTag.name,
        success: true,
      });
      updated++;
    } catch {
      actions.push({
        action: "update",
        resourceType: "tag",
        id: currentTag.tagId,
        name: snapshotTag.name,
        success: false,
      });
      failed++;
    }
  }

  return { created, updated, skipped, failed };
}

async function restoreTriggers(
  snapshotTriggers: GtmTrigger[],
  currentTriggers: GtmTrigger[],
  dryRun: boolean,
  actions: RestoreAction[],
  keepTriggerIds: Set<string>,
): Promise<{
  created: number;
  updated: number;
  skipped: number;
  failed: number;
  idMap: Map<string, string>;
}> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  const idMap = new Map<string, string>();

  for (const snapshotTrigger of snapshotTriggers) {
    const currentTrigger = resolveSnapshotIdentity(snapshotTrigger, currentTriggers, "triggerId");
    if (!currentTrigger) {
      if (dryRun) {
        actions.push({
          action: "create",
          resourceType: "trigger",
          id: snapshotTrigger.triggerId,
          name: snapshotTrigger.name,
          detail: "Would create",
        });
        created++;
        if (snapshotTrigger.triggerId)
          idMap.set(snapshotTrigger.triggerId, snapshotTrigger.triggerId);
        const snapshotTagOpsId = getTagOpsId(snapshotTrigger.notes);
        if (snapshotTagOpsId) idMap.set(snapshotTagOpsId, snapshotTrigger.triggerId);
      } else {
        const result = await createTrigger(
          snapshotTrigger.name,
          snapshotTrigger.type,
          createTriggerConfig(snapshotTrigger),
        );
        if (result) {
          actions.push({
            action: "create",
            resourceType: "trigger",
            id: snapshotTrigger.triggerId,
            name: snapshotTrigger.name,
            success: true,
          });
          created++;
          if (snapshotTrigger.triggerId) idMap.set(snapshotTrigger.triggerId, result.triggerId);
          const snapshotTagOpsId = getTagOpsId(snapshotTrigger.notes);
          if (snapshotTagOpsId) idMap.set(snapshotTagOpsId, result.triggerId);
        } else {
          actions.push({
            action: "create",
            resourceType: "trigger",
            id: snapshotTrigger.triggerId,
            name: snapshotTrigger.name,
            success: false,
          });
          failed++;
        }
      }
      continue;
    }

    keepTriggerIds.add(currentTrigger.triggerId);
    if (snapshotTrigger.triggerId) idMap.set(snapshotTrigger.triggerId, currentTrigger.triggerId);
    const snapshotTagOpsId = getTagOpsId(snapshotTrigger.notes);
    if (snapshotTagOpsId) idMap.set(snapshotTagOpsId, currentTrigger.triggerId);
    const currentComparable = normalizeTrigger(currentTrigger);
    const snapshotComparable = normalizeTrigger(snapshotTrigger);

    if (isEquivalent(currentComparable, snapshotComparable)) {
      actions.push({
        action: "skip",
        resourceType: "trigger",
        id: currentTrigger.triggerId,
        name: snapshotTrigger.name,
        detail: "Already matches snapshot",
      });
      skipped++;
      continue;
    }

    if (dryRun) {
      actions.push({
        action: "update",
        resourceType: "trigger",
        id: currentTrigger.triggerId,
        name: snapshotTrigger.name,
        detail: "Would update",
      });
      updated++;
      continue;
    }

    try {
      await updateTrigger(currentTrigger.triggerId, {
        name: snapshotTrigger.name,
        type: snapshotTrigger.type,
        ...updateTriggerConfig(snapshotTrigger, currentTrigger),
      });
      actions.push({
        action: "update",
        resourceType: "trigger",
        id: currentTrigger.triggerId,
        name: snapshotTrigger.name,
        success: true,
      });
      updated++;
    } catch {
      actions.push({
        action: "update",
        resourceType: "trigger",
        id: currentTrigger.triggerId,
        name: snapshotTrigger.name,
        success: false,
      });
      failed++;
    }
  }

  return { created, updated, skipped, failed, idMap };
}

async function restoreVariables(
  snapshotVariables: GtmVariable[],
  currentVariables: GtmVariable[],
  dryRun: boolean,
  actions: RestoreAction[],
  keepVariableIds: Set<string>,
): Promise<{ created: number; updated: number; skipped: number; failed: number }> {
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  for (const snapshotVariable of snapshotVariables) {
    const currentVariable = resolveSnapshotIdentity(
      snapshotVariable,
      currentVariables,
      "variableId",
    );
    if (!currentVariable) {
      if (dryRun) {
        actions.push({
          action: "create",
          resourceType: "variable",
          id: snapshotVariable.variableId,
          name: snapshotVariable.name,
          detail: "Would create",
        });
        created++;
      } else {
        const result = await createVariable(
          snapshotVariable.name,
          snapshotVariable.type,
          createVariableConfig(snapshotVariable),
        );
        if (result) {
          actions.push({
            action: "create",
            resourceType: "variable",
            id: snapshotVariable.variableId,
            name: snapshotVariable.name,
            success: true,
          });
          created++;
        } else {
          actions.push({
            action: "create",
            resourceType: "variable",
            id: snapshotVariable.variableId,
            name: snapshotVariable.name,
            success: false,
          });
          failed++;
        }
      }
      continue;
    }

    keepVariableIds.add(currentVariable.variableId);
    const currentComparable = normalizeVariable(currentVariable);
    const snapshotComparable = normalizeVariable(snapshotVariable);

    if (isEquivalent(currentComparable, snapshotComparable)) {
      actions.push({
        action: "skip",
        resourceType: "variable",
        id: currentVariable.variableId,
        name: snapshotVariable.name,
        detail: "Already matches snapshot",
      });
      skipped++;
      continue;
    }

    if (dryRun) {
      actions.push({
        action: "update",
        resourceType: "variable",
        id: currentVariable.variableId,
        name: snapshotVariable.name,
        detail: "Would update",
      });
      updated++;
      continue;
    }

    try {
      await updateVariable(currentVariable.variableId, {
        name: snapshotVariable.name,
        ...updateVariableConfig(snapshotVariable, currentVariable),
      });
      actions.push({
        action: "update",
        resourceType: "variable",
        id: currentVariable.variableId,
        name: snapshotVariable.name,
        success: true,
      });
      updated++;
    } catch {
      actions.push({
        action: "update",
        resourceType: "variable",
        id: currentVariable.variableId,
        name: snapshotVariable.name,
        success: false,
      });
      failed++;
    }
  }

  return { created, updated, skipped, failed };
}

async function deleteMissingResources(
  currentTags: GtmTag[],
  currentTriggers: GtmTrigger[],
  currentVariables: GtmVariable[],
  keepTagIds: Set<string>,
  keepTriggerIds: Set<string>,
  keepVariableIds: Set<string>,
  dryRun: boolean,
  actions: RestoreAction[],
): Promise<{ deleted: number; failed: number }> {
  let deleted = 0;
  let failed = 0;

  for (const tag of uniqueById(currentTags, (item) => item.tagId)) {
    if (keepTagIds.has(tag.tagId)) continue;
    if (dryRun) {
      actions.push({
        action: "delete",
        resourceType: "tag",
        id: tag.tagId,
        name: tag.name,
        detail: "Would delete",
      });
      deleted++;
      continue;
    }

    const success = await deleteTag(tag.tagId);
    actions.push({ action: "delete", resourceType: "tag", id: tag.tagId, name: tag.name, success });
    if (success) deleted++;
    else failed++;
  }

  for (const trigger of uniqueById(currentTriggers, (item) => item.triggerId)) {
    if (BUILTIN_TRIGGER_IDS.has(trigger.triggerId) || keepTriggerIds.has(trigger.triggerId))
      continue;
    if (dryRun) {
      actions.push({
        action: "delete",
        resourceType: "trigger",
        id: trigger.triggerId,
        name: trigger.name,
        detail: "Would delete",
      });
      deleted++;
      continue;
    }

    const success = await deleteTrigger(trigger.triggerId);
    actions.push({
      action: "delete",
      resourceType: "trigger",
      id: trigger.triggerId,
      name: trigger.name,
      success,
    });
    if (success) deleted++;
    else failed++;
  }

  for (const variable of uniqueById(currentVariables, (item) => item.variableId)) {
    if (keepVariableIds.has(variable.variableId)) continue;
    if (dryRun) {
      actions.push({
        action: "delete",
        resourceType: "variable",
        id: variable.variableId,
        name: variable.name,
        detail: "Would delete",
      });
      deleted++;
      continue;
    }

    const success = await deleteVariable(variable.variableId);
    actions.push({
      action: "delete",
      resourceType: "variable",
      id: variable.variableId,
      name: variable.name,
      success,
    });
    if (success) deleted++;
    else failed++;
  }

  return { deleted, failed };
}

export async function restoreWorkspace(
  snapshotPath: string,
  options: RestoreOptions,
): Promise<RestoreResult> {
  const filePath = resolve(snapshotPath);
  if (!existsSync(filePath)) {
    throw new Error(`Snapshot file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const snapshot = parseSnapshot(raw) as GtmSnapshot;

  const currentTags = await listTags();
  const currentTriggers = await listTriggers();
  const currentVariables = await listVariables();

  if (currentTags.length === 0 && currentTriggers.length === 0 && !options.dryRun) {
    throw new Error("Cannot connect to GTM. Run: tagops auth login");
  }

  const actions: RestoreAction[] = [];
  const keepTagIds = new Set<string>();
  const keepTriggerIds = new Set<string>();
  const keepVariableIds = new Set<string>();

  const variableResult = await restoreVariables(
    snapshot.variables,
    currentVariables,
    options.dryRun,
    actions,
    keepVariableIds,
  );
  const triggerResult = await restoreTriggers(
    snapshot.triggers,
    currentTriggers,
    options.dryRun,
    actions,
    keepTriggerIds,
  );
  const tagResult = await restoreTags(
    snapshot.tags,
    currentTags,
    triggerResult.idMap,
    options.dryRun,
    actions,
    keepTagIds,
  );

  const deleteResult = options.allowDelete
    ? await deleteMissingResources(
        currentTags,
        currentTriggers,
        currentVariables,
        keepTagIds,
        keepTriggerIds,
        keepVariableIds,
        options.dryRun,
        actions,
      )
    : { deleted: 0, failed: 0 };

  return {
    snapshotFile: filePath,
    dryRun: options.dryRun,
    actions: sortActions(actions),
    summary: {
      created: tagResult.created + triggerResult.created + variableResult.created,
      updated: tagResult.updated + triggerResult.updated + variableResult.updated,
      deleted: deleteResult.deleted,
      skipped: tagResult.skipped + triggerResult.skipped + variableResult.skipped,
      failed: tagResult.failed + triggerResult.failed + variableResult.failed + deleteResult.failed,
    },
  };
}

export function printRestoreResult(result: RestoreResult): void {
  const prefix = result.dryRun ? chalk.cyan("[DRY RUN] ") : "";
  console.log(chalk.bold(`\n  ${prefix}GTM Workspace Restore\n`));
  console.log(`  From: ${chalk.gray(result.snapshotFile)}\n`);

  for (const action of result.actions) {
    if (action.action === "skip") continue;
    const icon =
      action.action === "create"
        ? chalk.green("+")
        : action.action === "update"
          ? chalk.yellow("~")
          : chalk.red("-");
    const status = action.success === false ? chalk.red(" FAILED") : "";
    console.log(`  ${icon} [${action.resourceType}] ${action.name}${status}`);
  }

  const s = result.summary;
  console.log(chalk.bold("\n  Summary"));
  console.log(`    Created:  ${s.created}`);
  console.log(`    Updated:  ${s.updated}`);
  console.log(`    Deleted:  ${s.deleted}`);
  console.log(`    Skipped:  ${s.skipped}`);
  if (s.failed > 0) console.log(chalk.red(`    Failed:   ${s.failed}`));
  console.log();
}
