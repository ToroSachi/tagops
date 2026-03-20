import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk, { type ChalkInstance } from "chalk";
import { BUILTIN_TRIGGER_IDS } from "../lib/architecture.js";
import { listFolders, listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import { getTagOpsId, matchResources, stripTagOpsId } from "../lib/identity.js";
import { parseSnapshot } from "../types/schemas.js";
import type { GtmFolder, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";
import type { GtmSnapshot } from "./snapshot.js";

export type PlanActionType = "create" | "update" | "delete";
export type PlanResourceType = "tag" | "trigger" | "variable" | "folder";
export type PlanRiskLevel = "low" | "medium" | "high" | "critical";

export interface PlanAction {
  action: PlanActionType;
  resourceType: PlanResourceType;
  id: string;
  name: string;
  changes?: string[];
  detail?: string;
}

export interface ResourcePlanCounts {
  current: number;
  snapshot: number;
  create: number;
  update: number;
  delete: number;
  unchanged: number;
}

export interface PlanResult {
  snapshotFile: string;
  snapshotTimestamp: string;
  actions: PlanAction[];
  resourceCounts: {
    tags: ResourcePlanCounts;
    triggers: ResourcePlanCounts;
    variables: ResourcePlanCounts;
    folders: ResourcePlanCounts;
    total: ResourcePlanCounts;
  };
  safetyWarnings: string[];
  riskLevel: PlanRiskLevel;
}

export interface PlanOptions {
  allowDelete?: boolean;
  includeFolders?: boolean;
}

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

interface PlannedResourceResult {
  actions: PlanAction[];
  counts: ResourcePlanCounts;
}

interface PlannedTriggerResult extends PlannedResourceResult {
  idMap: Map<string, string>;
}

function coerceArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

const ZERO_COUNTS: ResourcePlanCounts = {
  current: 0,
  snapshot: 0,
  create: 0,
  update: 0,
  delete: 0,
  unchanged: 0,
};

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

function normalizeFolder(folder: RestorableFolder): Record<string, unknown> {
  return {
    name: folder.name,
    notes: folder.notes ?? null,
  };
}

function getChangedFields(
  currentValue: Record<string, unknown>,
  desiredValue: Record<string, unknown>,
): string[] {
  const keys = new Set([...Object.keys(currentValue), ...Object.keys(desiredValue)]);
  const changes: string[] = [];
  for (const key of keys) {
    if (JSON.stringify(currentValue[key]) !== JSON.stringify(desiredValue[key])) {
      changes.push(key);
    }
  }
  return changes.sort();
}

function sortActions(actions: PlanAction[]): PlanAction[] {
  const actionOrder: Record<PlanActionType, number> = {
    create: 0,
    update: 1,
    delete: 2,
  };
  const typeOrder: Record<PlanResourceType, number> = {
    folder: 0,
    trigger: 1,
    variable: 2,
    tag: 3,
  };

  return [...actions].sort((a, b) => {
    const actionDelta = actionOrder[a.action] - actionOrder[b.action];
    if (actionDelta !== 0) return actionDelta;
    const typeDelta = typeOrder[a.resourceType] - typeOrder[b.resourceType];
    if (typeDelta !== 0) return typeDelta;
    return a.name.localeCompare(b.name);
  });
}

function zeroCounts(): ResourcePlanCounts {
  return { ...ZERO_COUNTS };
}

function addCounts(a: ResourcePlanCounts, b: ResourcePlanCounts): ResourcePlanCounts {
  return {
    current: a.current + b.current,
    snapshot: a.snapshot + b.snapshot,
    create: a.create + b.create,
    update: a.update + b.update,
    delete: a.delete + b.delete,
    unchanged: a.unchanged + b.unchanged,
  };
}

function summarizeNames(names: string[], limit = 3): string {
  if (names.length <= limit) return names.join(", ");
  return `${names.slice(0, limit).join(", ")} and ${names.length - limit} more`;
}

function planVariables(
  snapshotVariables: GtmVariable[],
  currentVariables: GtmVariable[],
  allowDelete: boolean,
): PlannedResourceResult {
  const actions: PlanAction[] = [];
  const keepVariableIds = new Set<string>();
  let create = 0;
  let update = 0;
  let unchanged = 0;
  let remove = 0;

  for (const { source: snapshotVariable, target: currentVariable } of matchResources(
    snapshotVariables,
    currentVariables,
    "variableId",
    (item) => getTagOpsId(item.notes),
  )) {
    if (!currentVariable) {
      actions.push({
        action: "create",
        resourceType: "variable",
        id: snapshotVariable.variableId,
        name: snapshotVariable.name,
      });
      create++;
      continue;
    }

    keepVariableIds.add(currentVariable.variableId);
    const currentComparable = normalizeVariable(currentVariable);
    const snapshotComparable = normalizeVariable(snapshotVariable);
    const changes = getChangedFields(currentComparable, snapshotComparable);

    if (changes.length === 0) {
      unchanged++;
      continue;
    }

    actions.push({
      action: "update",
      resourceType: "variable",
      id: currentVariable.variableId,
      name: snapshotVariable.name,
      changes,
    });
    update++;
  }

  if (allowDelete) {
    for (const currentVariable of currentVariables) {
      if (keepVariableIds.has(currentVariable.variableId)) continue;
      actions.push({
        action: "delete",
        resourceType: "variable",
        id: currentVariable.variableId,
        name: currentVariable.name,
      });
      remove++;
    }
  }

  return {
    actions,
    counts: {
      current: currentVariables.length,
      snapshot: snapshotVariables.length,
      create,
      update,
      delete: remove,
      unchanged,
    },
  };
}

function planTriggers(
  snapshotTriggers: GtmTrigger[],
  currentTriggers: GtmTrigger[],
  allowDelete: boolean,
): PlannedTriggerResult {
  const actions: PlanAction[] = [];
  const keepTriggerIds = new Set<string>();
  const idMap = new Map<string, string>();
  let create = 0;
  let update = 0;
  let unchanged = 0;
  let remove = 0;

  for (const { source: snapshotTrigger, target: currentTrigger } of matchResources(
    snapshotTriggers,
    currentTriggers,
    "triggerId",
    (item) => getTagOpsId(item.notes),
  )) {
    if (!currentTrigger) {
      actions.push({
        action: "create",
        resourceType: "trigger",
        id: snapshotTrigger.triggerId,
        name: snapshotTrigger.name,
      });
      create++;
      if (snapshotTrigger.triggerId)
        idMap.set(snapshotTrigger.triggerId, snapshotTrigger.triggerId);
      const snapshotTagOpsId = getTagOpsId(snapshotTrigger.notes);
      if (snapshotTagOpsId) idMap.set(snapshotTagOpsId, snapshotTrigger.triggerId);
      continue;
    }

    keepTriggerIds.add(currentTrigger.triggerId);
    if (snapshotTrigger.triggerId) idMap.set(snapshotTrigger.triggerId, currentTrigger.triggerId);
    const snapshotTagOpsId = getTagOpsId(snapshotTrigger.notes);
    if (snapshotTagOpsId) idMap.set(snapshotTagOpsId, currentTrigger.triggerId);

    const currentComparable = normalizeTrigger(currentTrigger);
    const snapshotComparable = normalizeTrigger(snapshotTrigger);
    const changes = getChangedFields(currentComparable, snapshotComparable);

    if (changes.length === 0) {
      unchanged++;
      continue;
    }

    actions.push({
      action: "update",
      resourceType: "trigger",
      id: currentTrigger.triggerId,
      name: snapshotTrigger.name,
      changes,
    });
    update++;
  }

  if (allowDelete) {
    for (const currentTrigger of currentTriggers) {
      if (
        BUILTIN_TRIGGER_IDS.has(currentTrigger.triggerId) ||
        keepTriggerIds.has(currentTrigger.triggerId)
      ) {
        continue;
      }

      actions.push({
        action: "delete",
        resourceType: "trigger",
        id: currentTrigger.triggerId,
        name: currentTrigger.name,
      });
      remove++;
    }
  }

  return {
    actions,
    counts: {
      current: currentTriggers.length,
      snapshot: snapshotTriggers.length,
      create,
      update,
      delete: remove,
      unchanged,
    },
    idMap,
  };
}

function planTags(
  snapshotTags: GtmTag[],
  currentTags: GtmTag[],
  triggerIdMap: Map<string, string>,
  allowDelete: boolean,
): PlannedResourceResult {
  const actions: PlanAction[] = [];
  const keepTagIds = new Set<string>();
  let create = 0;
  let update = 0;
  let unchanged = 0;
  let remove = 0;

  for (const { source: snapshotTag, target: currentTag } of matchResources(
    snapshotTags,
    currentTags,
    "tagId",
    (item) => getTagOpsId(item.notes),
  )) {
    if (!currentTag) {
      actions.push({
        action: "create",
        resourceType: "tag",
        id: snapshotTag.tagId,
        name: snapshotTag.name,
      });
      create++;
      continue;
    }

    keepTagIds.add(currentTag.tagId);
    const currentComparable = normalizeTag(currentTag);
    const snapshotComparable = normalizeTagWithTriggerMap(snapshotTag, triggerIdMap);
    const changes = getChangedFields(currentComparable, snapshotComparable);

    if (changes.length === 0) {
      unchanged++;
      continue;
    }

    actions.push({
      action: "update",
      resourceType: "tag",
      id: currentTag.tagId,
      name: snapshotTag.name,
      changes,
    });
    update++;
  }

  if (allowDelete) {
    for (const currentTag of currentTags) {
      if (keepTagIds.has(currentTag.tagId)) continue;
      actions.push({
        action: "delete",
        resourceType: "tag",
        id: currentTag.tagId,
        name: currentTag.name,
      });
      remove++;
    }
  }

  return {
    actions,
    counts: {
      current: currentTags.length,
      snapshot: snapshotTags.length,
      create,
      update,
      delete: remove,
      unchanged,
    },
  };
}

function planFolders(
  snapshotFolders: GtmFolder[],
  currentFolders: GtmFolder[],
  allowDelete: boolean,
): PlannedResourceResult {
  const actions: PlanAction[] = [];
  const keepFolderIds = new Set<string>();
  let create = 0;
  let update = 0;
  let unchanged = 0;
  let remove = 0;

  for (const { source: snapshotFolder, target: currentFolder } of matchResources(
    snapshotFolders,
    currentFolders,
    "folderId",
    (item) => getTagOpsId(item.notes),
  )) {
    if (!currentFolder) {
      actions.push({
        action: "create",
        resourceType: "folder",
        id: snapshotFolder.folderId,
        name: snapshotFolder.name,
      });
      create++;
      continue;
    }

    keepFolderIds.add(currentFolder.folderId);
    const currentComparable = normalizeFolder(currentFolder);
    const snapshotComparable = normalizeFolder(snapshotFolder);
    const changes = getChangedFields(currentComparable, snapshotComparable);

    if (changes.length === 0) {
      unchanged++;
      continue;
    }

    actions.push({
      action: "update",
      resourceType: "folder",
      id: currentFolder.folderId,
      name: snapshotFolder.name,
      changes,
    });
    update++;
  }

  if (allowDelete) {
    for (const currentFolder of currentFolders) {
      if (keepFolderIds.has(currentFolder.folderId)) continue;
      actions.push({
        action: "delete",
        resourceType: "folder",
        id: currentFolder.folderId,
        name: currentFolder.name,
      });
      remove++;
    }
  }

  return {
    actions,
    counts: {
      current: currentFolders.length,
      snapshot: snapshotFolders.length,
      create,
      update,
      delete: remove,
      unchanged,
    },
  };
}

function buildSafetyWarnings(
  actions: PlanAction[],
  resourceCounts: PlanResult["resourceCounts"],
  currentTags: GtmTag[],
): string[] {
  const warnings: string[] = [];
  const deleteCount = actions.filter((action) => action.action === "delete").length;
  const totalCurrentResources = resourceCounts.total.current;
  const deleteRatio = totalCurrentResources > 0 ? deleteCount / totalCurrentResources : 0;

  if (deleteRatio > 0.5) {
    warnings.push(
      `Deletes ${deleteCount} of ${totalCurrentResources} live resources (${Math.round(deleteRatio * 100)}%).`,
    );
  }

  const consentTagUpdates = actions.filter(
    (action) =>
      action.resourceType === "tag" &&
      action.action === "update" &&
      action.changes?.includes("consentSettings"),
  );
  if (consentTagUpdates.length > 0) {
    warnings.push(
      `Modifies consent settings on ${consentTagUpdates.length} tag(s): ${summarizeNames(consentTagUpdates.map((action) => action.name))}.`,
    );
  }

  const deletedTriggers = new Map<string, string>();
  for (const action of actions) {
    if (action.resourceType === "trigger" && action.action === "delete") {
      deletedTriggers.set(action.id, action.name);
    }
  }

  if (deletedTriggers.size > 0) {
    const affectedPairs: string[] = [];
    for (const tag of currentTags) {
      const referencedIds = [
        ...(tag.firingTriggerId ?? []),
        ...(tag.blockingTriggerId ?? []),
      ].filter((triggerId, index, ids) => ids.indexOf(triggerId) === index);

      for (const triggerId of referencedIds) {
        const triggerName = deletedTriggers.get(triggerId);
        if (!triggerName) continue;
        affectedPairs.push(`${triggerName} -> ${tag.name}`);
      }
    }

    if (affectedPairs.length > 0) {
      warnings.push(
        `Removes trigger(s) still referenced by live tags: ${summarizeNames(affectedPairs)}.`,
      );
    }
  }

  return warnings;
}

function determineRiskLevel(
  actions: PlanAction[],
  warnings: string[],
  resourceCounts: PlanResult["resourceCounts"],
): PlanRiskLevel {
  const deleteCount = actions.filter((action) => action.action === "delete").length;
  const updateCount = actions.filter((action) => action.action === "update").length;
  const totalChanges = actions.length;
  const deleteRatio =
    resourceCounts.total.current > 0 ? deleteCount / resourceCounts.total.current : 0;

  const hasDeleteWarning = warnings.some((warning) => warning.startsWith("Deletes "));
  const hasConsentWarning = warnings.some((warning) => warning.startsWith("Modifies consent"));
  const hasTriggerDependencyWarning = warnings.some((warning) =>
    warning.startsWith("Removes trigger"),
  );

  if (hasDeleteWarning) return "critical";
  if (hasTriggerDependencyWarning || hasConsentWarning || deleteRatio > 0.25) return "high";
  if (deleteCount > 0 || updateCount > 20 || totalChanges > 40) return "medium";
  return "low";
}

function loadSnapshot(snapshotPath: string): { snapshot: GtmSnapshot; path: string } {
  const filePath = resolve(snapshotPath);

  if (!existsSync(filePath)) {
    throw new Error(`Snapshot file not found: ${filePath}`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const snapshot = parseSnapshot(raw) as GtmSnapshot;
  return { snapshot, path: filePath };
}

export async function plan(snapshotPath: string, options: PlanOptions = {}): Promise<PlanResult> {
  const { snapshot, path } = loadSnapshot(snapshotPath);
  const allowDelete = options.allowDelete ?? true;
  const includeFolders = options.includeFolders ?? true;

  const [loadedTags, loadedTriggers, loadedVariables, loadedFolders] = await Promise.all([
    listTags(),
    listTriggers(),
    listVariables(),
    listFolders(),
  ]);
  const currentTags = coerceArray<GtmTag>(loadedTags);
  const currentTriggers = coerceArray<GtmTrigger>(loadedTriggers);
  const currentVariables = coerceArray<GtmVariable>(loadedVariables);
  const currentFolders = coerceArray<GtmFolder>(loadedFolders);

  const variablePlan = planVariables(
    coerceArray<GtmVariable>(snapshot.variables),
    currentVariables,
    allowDelete,
  );
  const triggerPlan = planTriggers(
    coerceArray<GtmTrigger>(snapshot.triggers),
    currentTriggers,
    allowDelete,
  );
  const tagPlan = planTags(
    coerceArray<GtmTag>(snapshot.tags),
    currentTags,
    triggerPlan.idMap,
    allowDelete,
  );
  const folderPlan = includeFolders
    ? snapshot.folders
      ? planFolders(coerceArray<GtmFolder>(snapshot.folders), currentFolders, allowDelete)
      : { actions: [], counts: zeroCounts() }
    : { actions: [], counts: zeroCounts() };

  const actions = sortActions([
    ...folderPlan.actions,
    ...triggerPlan.actions,
    ...variablePlan.actions,
    ...tagPlan.actions,
  ]);

  const resourceCounts = {
    tags: tagPlan.counts,
    triggers: triggerPlan.counts,
    variables: variablePlan.counts,
    folders: folderPlan.counts,
    total: addCounts(
      addCounts(tagPlan.counts, triggerPlan.counts),
      addCounts(variablePlan.counts, folderPlan.counts),
    ),
  };

  const safetyWarnings = buildSafetyWarnings(actions, resourceCounts, currentTags);
  const riskLevel = determineRiskLevel(actions, safetyWarnings, resourceCounts);

  return {
    snapshotFile: path,
    snapshotTimestamp: snapshot.meta.timestamp,
    actions,
    resourceCounts,
    safetyWarnings,
    riskLevel,
  };
}

function riskColor(riskLevel: PlanRiskLevel): ChalkInstance {
  switch (riskLevel) {
    case "low":
      return chalk.green;
    case "medium":
      return chalk.yellow;
    case "high":
      return chalk.hex("#ff8c00");
    case "critical":
      return chalk.red;
  }
}

function printActionGroup(
  label: string,
  color: (text: string) => string,
  icon: string,
  actions: PlanAction[],
): void {
  if (actions.length === 0) return;
  console.log(color(chalk.bold(`  ${icon} ${label} (${actions.length})`)));
  for (const action of actions) {
    const changes =
      action.action === "update" && action.changes && action.changes.length > 0
        ? chalk.gray(` — ${action.changes.join(", ")}`)
        : "";
    console.log(
      color(`    ${icon} [${action.resourceType}] ${action.name} (${action.id})${changes}`),
    );
  }
  console.log();
}

function printCountRow(label: string, counts: ResourcePlanCounts, showArrow = true): void {
  const snapshotDelta = showArrow
    ? ` ${chalk.gray(`${counts.current} -> ${counts.snapshot}`)}`
    : "";
  console.log(
    `    ${label.padEnd(9)} ${chalk.green(`+${counts.create}`)} ${chalk.yellow(`~${counts.update}`)} ${chalk.red(`-${counts.delete}`)}${snapshotDelta}`,
  );
}

export function printPlan(result: PlanResult): void {
  const color = riskColor(result.riskLevel);
  const creates = result.actions.filter((action) => action.action === "create");
  const updates = result.actions.filter((action) => action.action === "update");
  const deletes = result.actions.filter((action) => action.action === "delete");

  console.log(chalk.bold("\n  GTM Restore Plan\n"));
  console.log(`  Snapshot: ${chalk.gray(result.snapshotFile)}`);
  console.log(`  Taken:    ${chalk.gray(result.snapshotTimestamp)}`);
  console.log(`  Risk:     ${color.bold(result.riskLevel.toUpperCase())}\n`);

  if (result.safetyWarnings.length > 0) {
    console.log(chalk.bold("  Safety Warnings"));
    for (const warning of result.safetyWarnings) {
      console.log(color(`    ! ${warning}`));
    }
    console.log();
  }

  console.log(chalk.bold("  Summary"));
  printCountRow("Tags", result.resourceCounts.tags);
  printCountRow("Triggers", result.resourceCounts.triggers);
  printCountRow("Variables", result.resourceCounts.variables);
  if (result.resourceCounts.folders.current > 0 || result.resourceCounts.folders.snapshot > 0) {
    printCountRow("Folders", result.resourceCounts.folders);
  }
  printCountRow("Total", result.resourceCounts.total, false);
  console.log();

  if (result.actions.length === 0) {
    console.log(chalk.green("  ✔ No changes required — workspace already matches the snapshot.\n"));
    return;
  }

  printActionGroup("Create", chalk.green, "+", creates);
  printActionGroup("Update", chalk.yellow, "~", updates);
  printActionGroup("Delete", chalk.red, "-", deletes);
}
