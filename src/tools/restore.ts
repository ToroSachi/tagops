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
  createFolder,
  listTags,
  listFolders,
  listTriggers,
  listVariables,
  createTag,
  updateTag,
  createTrigger,
  updateTrigger,
  createVariable,
  updateVariable,
  updateFolder,
  deleteTag,
  deleteTrigger,
  deleteVariable,
} from "../lib/gtm-cli.js";
import { BUILTIN_TRIGGER_IDS } from "../lib/architecture.js";
import { requireWriteAccess } from "../lib/permission-guard.js";
import { parseSnapshot } from "../types/schemas.js";
import type { GtmSnapshot } from "./snapshot.js";
import type { GtmFolder, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

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

type RestorableFolder = Partial<GtmFolder> & {
  notes?: string;
};

export interface RestoreAction {
  action: "create" | "update" | "delete" | "skip";
  resourceType: "folder" | "tag" | "trigger" | "variable";
  id: string;
  name: string;
  detail?: string;
  success?: boolean;
}

export interface RestoreResult {
  snapshotFile: string;
  dryRun: boolean;
  actions: RestoreAction[];
  folderOperations: {
    created: number;
    updated: number;
    skipped: number;
    failed: number;
  };
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

function getTagOpsId(notes?: string): string | undefined {
  if (!notes) return undefined;
  const match = notes.match(/TagOps-ID:\s*([^\n\r]+)/i);
  return match?.[1]?.trim();
}

function stripTagOpsId(notes?: string): string | undefined {
  if (!notes) return undefined;
  const withoutId = notes
    .replace(/(?:^|\n)\s*TagOps-ID:\s*[^\n\r]+\s*(?=\n|$)/gi, "\n")
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

function mapFolderId(
  folderId: string | undefined,
  folderIdMap: Map<string, string>,
): string | undefined {
  if (!folderId) return undefined;
  return folderIdMap.get(folderId) ?? folderId;
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
    parentFolderId: tag.parentFolderId ?? null,
    notes: stripTagOpsId(tag.notes),
  };
}

function normalizeTagWithMaps(
  tag: RestorableTag,
  triggerIdMap: Map<string, string>,
  folderIdMap: Map<string, string>,
): Record<string, unknown> {
  return {
    ...normalizeTag(tag),
    firingTriggerId: normalizeStringArray(mapTriggerIds(tag.firingTriggerId, triggerIdMap)),
    blockingTriggerId: normalizeStringArray(mapTriggerIds(tag.blockingTriggerId, triggerIdMap)),
    parentFolderId: mapFolderId(tag.parentFolderId, folderIdMap) ?? null,
  };
}

function normalizeTrigger(
  trigger: RestorableTrigger,
  folderIdMap?: Map<string, string>,
): Record<string, unknown> {
  return {
    name: trigger.name,
    type: trigger.type,
    filter: trigger.filter ?? [],
    customEventFilter: trigger.customEventFilter ?? [],
    parameter: trigger.parameter ?? [],
    parentFolderId: mapFolderId(trigger.parentFolderId, folderIdMap ?? new Map()) ?? null,
    notes: stripTagOpsId(trigger.notes),
  };
}

function normalizeVariable(
  variable: RestorableVariable,
  folderIdMap?: Map<string, string>,
): Record<string, unknown> {
  return {
    name: variable.name,
    type: variable.type,
    parameter: variable.parameter ?? [],
    parentFolderId: mapFolderId(variable.parentFolderId, folderIdMap ?? new Map()) ?? null,
    notes: stripTagOpsId(variable.notes),
  };
}

function normalizeFolder(folder: RestorableFolder): Record<string, unknown> {
  return {
    name: folder.name,
    notes: stripTagOpsId(folder.notes),
  };
}

function createFolderConfig(
  folder: RestorableFolder,
  current?: RestorableFolder,
): Record<string, unknown> {
  return {
    notes: folder.notes ?? current?.notes,
  };
}

function updateFolderConfig(
  folder: RestorableFolder,
  current?: RestorableFolder,
): Record<string, unknown> {
  return {
    name: folder.name,
    notes: folder.notes ?? current?.notes,
  };
}

function createTagConfig(
  tag: RestorableTag,
  triggerIdMap: Map<string, string>,
  folderIdMap: Map<string, string>,
  current?: RestorableTag,
): Record<string, unknown> {
  const notes = tag.notes ?? current?.notes;
  const config: Record<string, unknown> = {
    parameter: tag.parameter ?? [],
    consentSettings: tag.consentSettings,
    paused: tag.paused,
    tagFiringOption: tag.tagFiringOption,
    parentFolderId: mapFolderId(tag.parentFolderId, folderIdMap),
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
  folderIdMap: Map<string, string>,
  current?: RestorableTag,
): Record<string, unknown> {
  const firingTriggerId = mapTriggerIds(tag.firingTriggerId, triggerIdMap);
  const blockingTriggerId = mapTriggerIds(tag.blockingTriggerId, triggerIdMap);

  return buildCompleteTagConfig(tag, {
    parentFolderId: mapFolderId(tag.parentFolderId, folderIdMap),
    notes: tag.notes ?? current?.notes,
    firingTriggerId,
    blockingTriggerId,
  });
}

function createTriggerConfig(
  trigger: RestorableTrigger,
  folderIdMap: Map<string, string>,
  current?: RestorableTrigger,
): Record<string, unknown> {
  return {
    customEventFilter: trigger.customEventFilter,
    filter: trigger.filter,
    parameter: trigger.parameter ?? [],
    parentFolderId: mapFolderId(trigger.parentFolderId, folderIdMap),
    notes: trigger.notes ?? current?.notes,
  };
}

function updateTriggerConfig(
  trigger: RestorableTrigger,
  folderIdMap: Map<string, string>,
  current?: RestorableTrigger,
): Record<string, unknown> {
  return {
    type: trigger.type,
    customEventFilter: trigger.customEventFilter,
    filter: trigger.filter,
    parameter: trigger.parameter ?? [],
    parentFolderId: mapFolderId(trigger.parentFolderId, folderIdMap),
    notes: trigger.notes ?? current?.notes,
  };
}

function createVariableConfig(
  variable: RestorableVariable,
  folderIdMap: Map<string, string>,
  current?: RestorableVariable,
): Record<string, unknown> {
  return {
    parameter: variable.parameter ?? [],
    parentFolderId: mapFolderId(variable.parentFolderId, folderIdMap),
    notes: variable.notes ?? current?.notes,
  };
}

function updateVariableConfig(
  variable: RestorableVariable,
  folderIdMap: Map<string, string>,
  current?: RestorableVariable,
): Record<string, unknown> {
  return {
    type: variable.type,
    parameter: variable.parameter ?? [],
    parentFolderId: mapFolderId(variable.parentFolderId, folderIdMap),
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

async function restoreFolders(
  snapshotFolders: GtmFolder[],
  currentFolders: GtmFolder[],
  dryRun: boolean,
  actions: RestoreAction[],
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

  for (const snapshotFolder of snapshotFolders) {
    const currentFolder = resolveSnapshotIdentity(snapshotFolder, currentFolders, "folderId");

    if (!currentFolder) {
      if (dryRun) {
        actions.push({
          action: "create",
          resourceType: "folder",
          id: snapshotFolder.folderId,
          name: snapshotFolder.name,
          detail: "Would create",
        });
        created++;
        if (snapshotFolder.folderId) idMap.set(snapshotFolder.folderId, snapshotFolder.folderId);
      } else {
        const result = await createFolder(snapshotFolder.name, createFolderConfig(snapshotFolder));
        if (result) {
          actions.push({
            action: "create",
            resourceType: "folder",
            id: snapshotFolder.folderId,
            name: snapshotFolder.name,
            success: true,
          });
          created++;
          if (snapshotFolder.folderId) idMap.set(snapshotFolder.folderId, result.folderId);
        } else {
          actions.push({
            action: "create",
            resourceType: "folder",
            id: snapshotFolder.folderId,
            name: snapshotFolder.name,
            success: false,
          });
          failed++;
        }
      }
      continue;
    }

    if (snapshotFolder.folderId) idMap.set(snapshotFolder.folderId, currentFolder.folderId);
    const currentComparable = normalizeFolder(currentFolder);
    const snapshotComparable = normalizeFolder(snapshotFolder);

    if (isEquivalent(currentComparable, snapshotComparable)) {
      actions.push({
        action: "skip",
        resourceType: "folder",
        id: currentFolder.folderId,
        name: snapshotFolder.name,
        detail: "Already matches snapshot",
      });
      skipped++;
      continue;
    }

    if (dryRun) {
      actions.push({
        action: "update",
        resourceType: "folder",
        id: currentFolder.folderId,
        name: snapshotFolder.name,
        detail: "Would update",
      });
      updated++;
      continue;
    }

    try {
      await updateFolder(currentFolder.folderId, updateFolderConfig(snapshotFolder, currentFolder));
      actions.push({
        action: "update",
        resourceType: "folder",
        id: currentFolder.folderId,
        name: snapshotFolder.name,
        success: true,
      });
      updated++;
    } catch {
      actions.push({
        action: "update",
        resourceType: "folder",
        id: currentFolder.folderId,
        name: snapshotFolder.name,
        success: false,
      });
      failed++;
    }
  }

  return { created, updated, skipped, failed, idMap };
}

async function restoreTags(
  snapshotTags: GtmTag[],
  currentTags: GtmTag[],
  triggerIdMap: Map<string, string>,
  folderIdMap: Map<string, string>,
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
          config: createTagConfig(snapshotTag, triggerIdMap, folderIdMap),
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
    const snapshotComparable = normalizeTagWithMaps(snapshotTag, triggerIdMap, folderIdMap);

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
        config: updateTagConfig(snapshotTag, triggerIdMap, folderIdMap, currentTag),
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
  folderIdMap: Map<string, string>,
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
          createTriggerConfig(snapshotTrigger, folderIdMap),
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
    const snapshotComparable = normalizeTrigger(snapshotTrigger, folderIdMap);

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
        ...updateTriggerConfig(snapshotTrigger, folderIdMap, currentTrigger),
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
  folderIdMap: Map<string, string>,
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
          createVariableConfig(snapshotVariable, folderIdMap),
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
    const snapshotComparable = normalizeVariable(snapshotVariable, folderIdMap);

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
        ...updateVariableConfig(snapshotVariable, folderIdMap, currentVariable),
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
  if (!options.dryRun) {
    await requireWriteAccess();
  }

  const filePath = resolve(snapshotPath);
  if (!existsSync(filePath)) {
    throw new Error(`Snapshot file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const snapshot = parseSnapshot(raw) as GtmSnapshot;

  const [currentFolders, currentTags, currentTriggers, currentVariables] = await Promise.all([
    listFolders(),
    listTags(),
    listTriggers(),
    listVariables(),
  ]);

  const actions: RestoreAction[] = [];
  const keepTagIds = new Set<string>();
  const keepTriggerIds = new Set<string>();
  const keepVariableIds = new Set<string>();
  const folderResult = await restoreFolders(
    snapshot.folders ?? [],
    currentFolders,
    options.dryRun,
    actions,
  );

  const variableResult = await restoreVariables(
    snapshot.variables,
    currentVariables,
    folderResult.idMap,
    options.dryRun,
    actions,
    keepVariableIds,
  );
  const triggerResult = await restoreTriggers(
    snapshot.triggers,
    currentTriggers,
    folderResult.idMap,
    options.dryRun,
    actions,
    keepTriggerIds,
  );
  const tagResult = await restoreTags(
    snapshot.tags,
    currentTags,
    triggerResult.idMap,
    folderResult.idMap,
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
    folderOperations: {
      created: folderResult.created,
      updated: folderResult.updated,
      skipped: folderResult.skipped,
      failed: folderResult.failed,
    },
    summary: {
      created:
        folderResult.created + tagResult.created + triggerResult.created + variableResult.created,
      updated:
        folderResult.updated + tagResult.updated + triggerResult.updated + variableResult.updated,
      deleted: deleteResult.deleted,
      skipped:
        folderResult.skipped + tagResult.skipped + triggerResult.skipped + variableResult.skipped,
      failed:
        folderResult.failed +
        tagResult.failed +
        triggerResult.failed +
        variableResult.failed +
        deleteResult.failed,
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
  const folders = result.folderOperations;
  console.log(chalk.bold("\n  Summary"));
  console.log(`    Created:  ${s.created}`);
  console.log(`    Updated:  ${s.updated}`);
  console.log(`    Deleted:  ${s.deleted}`);
  console.log(`    Skipped:  ${s.skipped}`);
  console.log(
    `    Folders:  ${chalk.green(`+${folders.created}`)} ${chalk.yellow(`~${folders.updated}`)} ${chalk.gray(`=${folders.skipped}`)}`,
  );
  if (s.failed > 0) console.log(chalk.red(`    Failed:   ${s.failed}`));
  console.log();
}
