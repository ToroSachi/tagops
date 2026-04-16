/**
 * Drift Detection — semantic comparison between a saved snapshot and live GTM workspace.
 *
 * Tracks field-level drift for tags, triggers, and variables while ignoring
 * volatile GTM API fields such as fingerprints and resource paths.
 */

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { listTags, listTriggers, listVariables, verifyGtmConnection } from "../lib/gtm-cli.js";
import { normalizeForComparison, type NormalizedComparisonValue } from "../lib/comparator.js";
import {
  getTagOpsId,
  matchResources,
  stripTagOpsId,
  stripVolatileFields,
} from "../lib/identity.js";
import { parseSnapshot } from "../types/schemas.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";
import type { GtmSnapshot } from "./snapshot.js";

export type DriftResourceType = "tag" | "trigger" | "variable";
export type DriftClassification = "managed" | "unmanaged";
export type DriftChangeType = "added" | "modified" | "deleted";

interface DriftSnapshot {
  meta: GtmSnapshot["meta"];
  tags: GtmTag[];
  triggers: GtmTrigger[];
  variables: GtmVariable[];
}
type DriftResource = GtmTag | GtmTrigger | GtmVariable;
type ComparableValue = NormalizedComparisonValue;

const DEFAULT_SNAPSHOT_PATH = "gtm-snapshot.json";

export interface DriftedResource {
  name: string;
  type: DriftResourceType;
  resourceType: DriftResourceType;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  classification: DriftClassification;
  changeType: Exclude<DriftChangeType, "deleted">;
  id?: string;
  gtmType?: string;
  tagOpsId?: string;
}

export interface DriftResourceSummary {
  name: string;
  type: DriftResourceType;
  resourceType: DriftResourceType;
  classification: DriftClassification;
  changeType: Exclude<DriftChangeType, "deleted">;
  fields: string[];
  id?: string;
  gtmType?: string;
  tagOpsId?: string;
}

export interface DeletedResource {
  name: string;
  type: DriftResourceType;
  resourceType: DriftResourceType;
  classification: DriftClassification;
  id?: string;
  gtmType?: string;
  tagOpsId?: string;
}

export interface DriftChangeSummary {
  name: string;
  type: DriftResourceType;
  resourceType: DriftResourceType;
  classification: DriftClassification;
  changeType: DriftChangeType;
  fields: string[];
  id?: string;
  gtmType?: string;
  tagOpsId?: string;
}

export interface DriftReport {
  snapshotFile: string;
  snapshotTimestamp: string;
  driftedResources: DriftedResource[];
  unmanagedResources: DriftResourceSummary[];
  deletedResources: DeletedResource[];
  summary: {
    totalChanges: number;
    driftedFields: number;
    driftedResources: number;
    unmanagedResources: number;
    deletedResources: number;
    managedChanges: number;
    unmanagedChanges: number;
  };
}

interface ResourceDescriptor<T extends DriftResource> {
  type: DriftResourceType;
  idKey: keyof T;
  select: (snapshot: DriftSnapshot) => T[];
}

interface ResourceMetadata {
  name: string;
  type: DriftResourceType;
  resourceType: DriftResourceType;
  classification: DriftClassification;
  id?: string;
  gtmType?: string;
  tagOpsId?: string;
}

const TAG_DESCRIPTOR: ResourceDescriptor<GtmTag> = {
  type: "tag",
  idKey: "tagId",
  select: (snapshot) => snapshot.tags,
};

const TRIGGER_DESCRIPTOR: ResourceDescriptor<GtmTrigger> = {
  type: "trigger",
  idKey: "triggerId",
  select: (snapshot) => snapshot.triggers,
};

const VARIABLE_DESCRIPTOR: ResourceDescriptor<GtmVariable> = {
  type: "variable",
  idKey: "variableId",
  select: (snapshot) => snapshot.variables,
};

const RESOURCE_DESCRIPTORS = [TAG_DESCRIPTOR, TRIGGER_DESCRIPTOR, VARIABLE_DESCRIPTOR] as const;

export function getResourceClassification(item: { notes?: string }): DriftClassification {
  return getTagOpsId(item.notes) ? "managed" : "unmanaged";
}

export async function captureWorkspaceSnapshot(): Promise<DriftSnapshot> {
  const [tags, triggers, variables] = await Promise.all([
    listTags(),
    listTriggers(),
    listVariables(),
  ]);

  if (tags.length === 0 && triggers.length === 0 && variables.length === 0) {
    await verifyGtmConnection();
  }

  return {
    meta: {
      timestamp: new Date().toISOString(),
      description: "Live workspace snapshot for drift detection",
    },
    tags,
    triggers,
    variables,
  };
}

export function loadDriftSnapshot(snapshotPath?: string): {
  snapshot: DriftSnapshot;
  path: string;
} {
  const filePath = resolve(snapshotPath ?? DEFAULT_SNAPSHOT_PATH);

  if (!existsSync(filePath)) {
    throw new Error(`Snapshot not found: ${filePath}\nRun 'tagops snapshot' to create one first.`);
  }

  const raw = readFileSync(filePath, "utf-8");
  const snapshot = parseSnapshot(raw) as GtmSnapshot;
  return {
    snapshot: {
      meta: snapshot.meta,
      tags: snapshot.tags,
      triggers: snapshot.triggers,
      variables: snapshot.variables,
    },
    path: filePath,
  };
}

export async function detectDrift(snapshotPath?: string): Promise<DriftReport> {
  const { snapshot, path } = loadDriftSnapshot(snapshotPath);
  const liveSnapshot = await captureWorkspaceSnapshot();
  return compareSnapshots(snapshot, liveSnapshot, {
    snapshotFile: path,
    snapshotTimestamp: snapshot.meta.timestamp,
  });
}

export function compareSnapshots(
  snapshot: DriftSnapshot,
  liveSnapshot: DriftSnapshot,
  options?: { snapshotFile?: string; snapshotTimestamp?: string },
): DriftReport {
  const driftedResources: DriftedResource[] = [];
  const deletedResources: DeletedResource[] = [];
  const unmanagedResourceMap = new Map<string, DriftResourceSummary>();

  compareCollection(
    TAG_DESCRIPTOR,
    snapshot,
    liveSnapshot,
    driftedResources,
    deletedResources,
    unmanagedResourceMap,
  );
  compareCollection(
    TRIGGER_DESCRIPTOR,
    snapshot,
    liveSnapshot,
    driftedResources,
    deletedResources,
    unmanagedResourceMap,
  );
  compareCollection(
    VARIABLE_DESCRIPTOR,
    snapshot,
    liveSnapshot,
    driftedResources,
    deletedResources,
    unmanagedResourceMap,
  );

  const sortedDriftedResources = driftedResources.sort(compareDriftedResource);
  const changeSummaries = summarizeDriftChangesFromEntries(
    sortedDriftedResources,
    deletedResources,
  );
  const managedChanges = changeSummaries.filter(
    (entry) => entry.classification === "managed",
  ).length;
  const unmanagedChanges = changeSummaries.filter(
    (entry) => entry.classification === "unmanaged",
  ).length;

  return {
    snapshotFile: options?.snapshotFile ?? "live workspace baseline",
    snapshotTimestamp: options?.snapshotTimestamp ?? snapshot.meta.timestamp,
    driftedResources: sortedDriftedResources,
    unmanagedResources: [...unmanagedResourceMap.values()].sort(compareResourceSummary),
    deletedResources: deletedResources.sort(compareDeletedResource),
    summary: {
      totalChanges: changeSummaries.length,
      driftedFields: driftedResources.length,
      driftedResources: uniqueResourceCount(driftedResources),
      unmanagedResources: unmanagedResourceMap.size,
      deletedResources: deletedResources.length,
      managedChanges,
      unmanagedChanges,
    },
  };
}

export function summarizeDriftChanges(report: DriftReport): DriftChangeSummary[] {
  return summarizeDriftChangesFromEntries(report.driftedResources, report.deletedResources);
}

export function filterDriftReport(
  report: DriftReport,
  classification: DriftClassification,
): DriftReport {
  const driftedResources = report.driftedResources.filter(
    (entry) => entry.classification === classification,
  );
  const deletedResources = report.deletedResources.filter(
    (entry) => entry.classification === classification,
  );
  const unmanagedResources =
    classification === "unmanaged" ? report.unmanagedResources.slice() : [];
  const changeSummaries = summarizeDriftChangesFromEntries(driftedResources, deletedResources);

  return {
    ...report,
    driftedResources,
    unmanagedResources,
    deletedResources,
    summary: {
      totalChanges: changeSummaries.length,
      driftedFields: driftedResources.length,
      driftedResources: uniqueResourceCount(driftedResources),
      unmanagedResources: unmanagedResources.length,
      deletedResources: deletedResources.length,
      managedChanges:
        classification === "managed"
          ? changeSummaries.length
          : changeSummaries.filter((entry) => entry.classification === "managed").length,
      unmanagedChanges:
        classification === "unmanaged"
          ? changeSummaries.length
          : changeSummaries.filter((entry) => entry.classification === "unmanaged").length,
    },
  };
}

export function hasDrift(report: DriftReport): boolean {
  return report.summary.totalChanges > 0;
}

export function printDriftReport(report: DriftReport): void {
  console.log(chalk.bold("\n  GTM Drift Report\n"));
  console.log(`  Comparing against: ${chalk.gray(report.snapshotFile)}`);
  console.log(`  Snapshot taken:    ${chalk.gray(report.snapshotTimestamp)}\n`);

  if (!hasDrift(report)) {
    console.log(chalk.green("  ✔ No semantic drift detected — workspace matches snapshot.\n"));
    return;
  }

  const changeSummaries = summarizeDriftChanges(report);

  console.log(chalk.bold(`  Changes (${changeSummaries.length})`));
  for (const entry of changeSummaries) {
    const color =
      entry.changeType === "deleted"
        ? chalk.red
        : entry.classification === "unmanaged"
          ? chalk.yellow
          : chalk.cyan;
    const fields =
      entry.changeType === "deleted"
        ? "deleted from live workspace"
        : entry.changeType === "added"
          ? "added in live workspace"
          : entry.fields.length > 0
            ? `changed: ${entry.fields.join(", ")}`
            : "added in live workspace";
    console.log(
      color(
        `    • [${entry.type}] ${entry.name} (${entry.classification}, ${entry.changeType}) — ${fields}`,
      ),
    );
  }

  if (report.driftedResources.length > 0) {
    console.log(chalk.yellow.bold(`\n  Field Drift (${report.driftedResources.length})`));
    for (const entry of report.driftedResources) {
      console.log(
        chalk.yellow(
          `    ~ [${entry.type}] ${entry.name} — ${entry.field}: ${formatValue(entry.oldValue)} -> ${formatValue(entry.newValue)}`,
        ),
      );
    }
  }

  if (report.unmanagedResources.length > 0) {
    console.log(chalk.yellow.bold(`\n  Unmanaged Resources (${report.unmanagedResources.length})`));
    for (const entry of report.unmanagedResources) {
      const fields = entry.fields.length > 0 ? ` — ${entry.fields.join(", ")}` : "";
      console.log(
        chalk.yellow(`    • [${entry.type}] ${entry.name} (${entry.changeType})${fields}`),
      );
    }
  }

  if (report.deletedResources.length > 0) {
    console.log(chalk.red.bold(`\n  Deleted Resources (${report.deletedResources.length})`));
    for (const entry of report.deletedResources) {
      console.log(chalk.red(`    - [${entry.type}] ${entry.name} (${entry.classification})`));
    }
  }

  console.log(chalk.bold("\n  Summary"));
  console.log(`    Resources changed: ${report.summary.totalChanges}`);
  console.log(`    Field differences: ${report.summary.driftedFields}`);
  console.log(`    Managed changes:   ${report.summary.managedChanges}`);
  console.log(`    Unmanaged changes: ${report.summary.unmanagedChanges}`);
  console.log();
}

function compareCollection<T extends DriftResource>(
  descriptor: ResourceDescriptor<T>,
  snapshot: DriftSnapshot,
  liveSnapshot: DriftSnapshot,
  driftedResources: DriftedResource[],
  deletedResources: DeletedResource[],
  unmanagedResourceMap: Map<string, DriftResourceSummary>,
): void {
  const snapshotItems = descriptor.select(snapshot);
  const liveItems = descriptor.select(liveSnapshot);
  const matchedLiveItems = new Set<T>();

  for (const { source: snapshotItem, target: liveItem } of matchResources(
    snapshotItems,
    liveItems,
    descriptor.idKey,
    (item) => getTagOpsId(item.notes),
  )) {
    if (!liveItem) {
      deletedResources.push(toDeletedResource(descriptor.type, snapshotItem));
      continue;
    }

    matchedLiveItems.add(liveItem);

    const metadata = getResourceMetadata(descriptor.type, liveItem);
    const diffs = diffComparableValues(
      normalizeResource(snapshotItem, descriptor.type),
      normalizeResource(liveItem, descriptor.type),
    );

    if (diffs.length === 0) continue;

    for (const diff of diffs) {
      driftedResources.push({
        ...metadata,
        changeType: "modified",
        field: diff.field,
        oldValue: diff.oldValue,
        newValue: diff.newValue,
      });
    }

    if (metadata.classification === "unmanaged") {
      addUnmanagedResource(
        unmanagedResourceMap,
        metadata,
        "modified",
        diffs.map((diff) => diff.field),
      );
    }
  }

  for (const liveItem of liveItems) {
    if (matchedLiveItems.has(liveItem)) continue;

    const metadata = getResourceMetadata(descriptor.type, liveItem);
    driftedResources.push({
      ...metadata,
      changeType: "added",
      field: "resource",
      oldValue: undefined,
      newValue: normalizeResource(liveItem, descriptor.type),
    });

    if (metadata.classification === "unmanaged") {
      addUnmanagedResource(unmanagedResourceMap, metadata, "added", ["resource"]);
    }
  }
}

function normalizeResource(
  resource: DriftResource,
  resourceType: DriftResourceType,
): ComparableValue {
  const base = stripVolatileFields(resource, ["tagId", "tagManagerUrl", "triggerId", "variableId"]);

  if (resourceType === "tag" && base.paused === undefined) {
    base.paused = false;
  }

  return (normalizeForComparison(base) ?? {}) as ComparableValue;
}

export { getTagOpsId, stripTagOpsId };

function stableStringify(value: ComparableValue | undefined): string {
  return JSON.stringify(value ?? null);
}

function diffComparableValues(
  oldValue: ComparableValue,
  newValue: ComparableValue,
  path = "",
): Array<{ field: string; oldValue: unknown; newValue: unknown }> {
  if (Array.isArray(oldValue) && Array.isArray(newValue)) {
    const diffs: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];
    const maxLength = Math.max(oldValue.length, newValue.length);

    for (let index = 0; index < maxLength; index++) {
      const nextPath = `${path}[${index}]`;
      if (index >= oldValue.length) {
        diffs.push({ field: nextPath, oldValue: undefined, newValue: newValue[index] });
        continue;
      }
      if (index >= newValue.length) {
        diffs.push({ field: nextPath, oldValue: oldValue[index], newValue: undefined });
        continue;
      }
      diffs.push(...diffComparableValues(oldValue[index], newValue[index], nextPath));
    }

    return diffs;
  }

  if (
    oldValue &&
    newValue &&
    typeof oldValue === "object" &&
    typeof newValue === "object" &&
    !Array.isArray(oldValue) &&
    !Array.isArray(newValue)
  ) {
    const oldObject = oldValue as Record<string, ComparableValue>;
    const newObject = newValue as Record<string, ComparableValue>;
    const keys = [...new Set([...Object.keys(oldObject), ...Object.keys(newObject)])].sort();
    const diffs: Array<{ field: string; oldValue: unknown; newValue: unknown }> = [];

    for (const key of keys) {
      const nextPath = path ? `${path}.${key}` : key;
      if (!(key in oldObject)) {
        diffs.push({ field: nextPath, oldValue: undefined, newValue: newObject[key] });
        continue;
      }
      if (!(key in newObject)) {
        diffs.push({ field: nextPath, oldValue: oldObject[key], newValue: undefined });
        continue;
      }
      diffs.push(...diffComparableValues(oldObject[key], newObject[key], nextPath));
    }

    return diffs;
  }

  if (stableStringify(oldValue) !== stableStringify(newValue)) {
    return [{ field: path || "resource", oldValue, newValue }];
  }

  return [];
}

function addUnmanagedResource(
  resourceMap: Map<string, DriftResourceSummary>,
  metadata: ResourceMetadata,
  changeType: Exclude<DriftChangeType, "deleted">,
  fields: string[],
): void {
  const key = summarizeResourceKey(metadata);
  const existing = resourceMap.get(key);
  const mergedFields = [...new Set([...(existing?.fields ?? []), ...fields])].sort();
  resourceMap.set(key, {
    ...metadata,
    changeType: existing?.changeType === "added" ? "added" : changeType,
    fields: mergedFields,
  });
}

function getResourceMetadata(
  resourceType: DriftResourceType,
  resource: DriftResource,
): ResourceMetadata {
  return {
    name: resource.name,
    type: resourceType,
    resourceType,
    classification: getResourceClassification(resource),
    id: getResourceId(resource),
    gtmType: resource.type,
    tagOpsId: getTagOpsId(resource.notes),
  };
}

function toDeletedResource(
  resourceType: DriftResourceType,
  resource: DriftResource,
): DeletedResource {
  return {
    ...getResourceMetadata(resourceType, resource),
  };
}

function getResourceId(resource: DriftResource): string | undefined {
  if ("tagId" in resource) return resource.tagId;
  if ("triggerId" in resource) return resource.triggerId;
  if ("variableId" in resource) return resource.variableId;
  return undefined;
}

function summarizeDriftChangesFromEntries(
  driftedResources: DriftedResource[],
  deletedResources: DeletedResource[],
): DriftChangeSummary[] {
  const summaryMap = new Map<string, DriftChangeSummary>();

  for (const entry of driftedResources) {
    const key = summarizeResourceKey(entry);
    const existing = summaryMap.get(key);
    const fields = [...new Set([...(existing?.fields ?? []), entry.field])].sort();
    summaryMap.set(key, {
      ...entry,
      fields,
    });
  }

  for (const entry of deletedResources) {
    const key = summarizeResourceKey(entry);
    summaryMap.set(key, {
      ...entry,
      changeType: "deleted",
      fields: [],
    });
  }

  return [...summaryMap.values()].sort(compareChangeSummary);
}

function summarizeResourceKey(
  resource:
    | Pick<ResourceMetadata, "type" | "name" | "id" | "tagOpsId">
    | Pick<DriftedResource, "type" | "name" | "id" | "changeType" | "tagOpsId">
    | Pick<DeletedResource, "type" | "name" | "id" | "tagOpsId">,
): string {
  const changeType = "changeType" in resource ? resource.changeType : "resource";
  return [
    resource.type,
    resource.tagOpsId ?? "",
    resource.id ?? "",
    resource.name,
    changeType,
  ].join("::");
}

function uniqueResourceCount(resources: DriftedResource[]): number {
  return new Set(resources.map((entry) => summarizeResourceKey(entry))).size;
}

function compareChangeSummary(a: DriftChangeSummary, b: DriftChangeSummary): number {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
}

function compareDriftedResource(a: DriftedResource, b: DriftedResource): number {
  return (
    a.type.localeCompare(b.type) || a.name.localeCompare(b.name) || a.field.localeCompare(b.field)
  );
}

function compareDeletedResource(a: DeletedResource, b: DeletedResource): number {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
}

function compareResourceSummary(a: DriftResourceSummary, b: DriftResourceSummary): number {
  return a.type.localeCompare(b.type) || a.name.localeCompare(b.name);
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "string") return value;
  return JSON.stringify(value);
}
