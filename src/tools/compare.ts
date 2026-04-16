/**
 * Multi-Container Compare Tool
 *
 * Compares two GTM containers side-by-side using profiles.
 * Essential for agencies managing staging/production or multi-client setups.
 *
 * Usage:
 *   tagops compare --source production --target staging
 *   tagops compare --source production --target staging --tags-only
 */

import chalk from "chalk";
import {
  areResourcesEqual,
  normalizeForComparison,
  type NormalizedComparisonValue,
} from "../lib/comparator.js";
import { loadConfig } from "../lib/config.js";
import { getTagOpsId } from "../lib/identity.js";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface ContainerSnapshot {
  profileName: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  tags: GtmTag[];
  triggers: GtmTrigger[];
  variables: GtmVariable[];
}

export interface CompareContainerState {
  profileName?: string;
  tags: GtmTag[];
  triggers: GtmTrigger[];
  variables: GtmVariable[];
}

export interface CompareResult {
  sourceProfile: string;
  targetProfile: string;
  tags: ResourceDiff[];
  triggers: ResourceDiff[];
  variables: ResourceDiff[];
  summary: string;
  warnings: string[];
}

export interface ResourceDiff {
  name: string;
  status: "only_in_source" | "only_in_target" | "different" | "identical";
  sourceId?: string;
  targetId?: string;
  differences?: string[];
}

interface CompareCollectionOptions {
  resourceLabel?: string;
  sourceLabel?: string;
  targetLabel?: string;
  warnings?: string[];
}

interface IndexedComparable<T> {
  item: T;
  normalized: NormalizedComparisonValue | undefined;
  normalizedString: string;
  id: string;
}

interface CompareContainersOptions {
  sourceState?: CompareContainerState;
  targetState?: CompareContainerState;
}

const EXTRA_COMPARISON_KEYS = ["tagId", "tagManagerUrl", "triggerId", "variableId"];

function coerceArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

/**
 * Fetch all resources from a specific profile's container.
 */
async function fetchContainerResources(profileName: string): Promise<ContainerSnapshot> {
  const config = loadConfig(profileName);
  const [tags, triggers, variables] = await Promise.all([
    listTags(profileName),
    listTriggers(profileName),
    listVariables(profileName),
  ]);

  return {
    profileName,
    accountId: config.accountId,
    containerId: config.containerId,
    workspaceId: config.workspaceId,
    tags: coerceArray<GtmTag>(tags),
    triggers: coerceArray<GtmTrigger>(triggers),
    variables: coerceArray<GtmVariable>(variables),
  };
}

/**
 * Extract a stable matching key from notes when available, falling back to name.
 */
export function getResourceKey(item: { name: string; notes?: string }): string {
  return getTagOpsId(item.notes) ?? item.name;
}

function stableComparisonString(value: NormalizedComparisonValue | undefined): string {
  return JSON.stringify(value ?? null);
}

function normalizeComparableResource(
  value: Record<string, unknown>,
): NormalizedComparisonValue | undefined {
  const comparable = { ...value };
  for (const key of EXTRA_COMPARISON_KEYS) {
    delete comparable[key];
  }
  return normalizeForComparison(comparable);
}

function toIndexedComparable<T extends { name: string }>(
  item: T,
  getId: (item: T) => string,
): IndexedComparable<T> {
  const normalized = normalizeComparableResource(item as unknown as Record<string, unknown>);
  return {
    item,
    normalized,
    normalizedString: stableComparisonString(normalized),
    id: getId(item),
  };
}

function sortIndexedComparables<T>(items: IndexedComparable<T>[]): IndexedComparable<T>[] {
  return items.slice().sort((a, b) => {
    const normalizedDelta = a.normalizedString.localeCompare(b.normalizedString);
    if (normalizedDelta !== 0) return normalizedDelta;
    return a.id.localeCompare(b.id);
  });
}

function groupResourcesByKey<T extends { name: string; notes?: string }>(
  items: T[],
): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = getResourceKey(item);
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

function isAmbiguousNameCollision<T extends { name: string; notes?: string }>(
  key: string,
  items: T[] | undefined,
): boolean {
  return (
    (items?.length ?? 0) > 1 &&
    (items ?? []).every((item) => !getTagOpsId(item.notes) && item.name === key)
  );
}

function addWarning(target: string[] | undefined, warning: string): void {
  if (!target || target.includes(warning)) return;
  target.push(warning);
}

function diffComparableValues(
  source: NormalizedComparisonValue | undefined,
  target: NormalizedComparisonValue | undefined,
  path = "",
): string[] {
  if (areResourcesEqual(source, target)) {
    return [];
  }

  if (Array.isArray(source) && Array.isArray(target)) {
    const diffs: string[] = [];
    const max = Math.max(source.length, target.length);
    for (let i = 0; i < max; i++) {
      const nextPath = `${path}[${i}]`;
      if (i >= source.length) {
        diffs.push(nextPath);
        continue;
      }
      if (i >= target.length) {
        diffs.push(nextPath);
        continue;
      }
      diffs.push(...diffComparableValues(source[i], target[i], nextPath));
    }
    return diffs;
  }

  if (
    source &&
    target &&
    typeof source === "object" &&
    typeof target === "object" &&
    !Array.isArray(source) &&
    !Array.isArray(target)
  ) {
    const sourceObj = source as Record<string, NormalizedComparisonValue>;
    const targetObj = target as Record<string, NormalizedComparisonValue>;
    const keys = new Set([...Object.keys(sourceObj), ...Object.keys(targetObj)]);
    const diffs: string[] = [];

    for (const key of [...keys].sort()) {
      const nextPath = path ? `${path}.${key}` : key;
      if (!(key in sourceObj) || !(key in targetObj)) {
        diffs.push(nextPath);
        continue;
      }
      diffs.push(...diffComparableValues(sourceObj[key], targetObj[key], nextPath));
    }
    return diffs;
  }

  return [path || "value"];
}

export function compareResourceCollections<T extends { name: string; notes?: string }>(
  source: T[],
  target: T[],
  getId: (item: T) => string,
  options: CompareCollectionOptions = {},
): ResourceDiff[] {
  const diffs: ResourceDiff[] = [];
  const sourceGroups = groupResourcesByKey(source);
  const targetGroups = groupResourcesByKey(target);

  for (const [key, items] of sourceGroups) {
    if (isAmbiguousNameCollision(key, items)) {
      addWarning(
        options.warnings,
        `${options.sourceLabel ?? "source"} ${options.resourceLabel ?? "resources"} contain duplicate name "${key}" without TagOps-ID metadata.`,
      );
    }
  }

  for (const [key, items] of targetGroups) {
    if (isAmbiguousNameCollision(key, items)) {
      addWarning(
        options.warnings,
        `${options.targetLabel ?? "target"} ${options.resourceLabel ?? "resources"} contain duplicate name "${key}" without TagOps-ID metadata.`,
      );
    }
  }

  const keys = [...new Set([...sourceGroups.keys(), ...targetGroups.keys()])].sort();

  for (const key of keys) {
    const sourceItems = sortIndexedComparables(
      (sourceGroups.get(key) ?? []).map((item) => toIndexedComparable(item, getId)),
    );
    const targetItems = sortIndexedComparables(
      (targetGroups.get(key) ?? []).map((item) => toIndexedComparable(item, getId)),
    );
    const max = Math.max(sourceItems.length, targetItems.length);

    for (let index = 0; index < max; index++) {
      const sourceEntry = sourceItems[index];
      const targetEntry = targetItems[index];

      if (!sourceEntry) {
        diffs.push({
          name: targetEntry.item.name,
          status: "only_in_target",
          targetId: targetEntry.id,
        });
        continue;
      }

      if (!targetEntry) {
        diffs.push({
          name: sourceEntry.item.name,
          status: "only_in_source",
          sourceId: sourceEntry.id,
        });
        continue;
      }

      const differences = diffComparableValues(sourceEntry.normalized, targetEntry.normalized);
      diffs.push({
        name: sourceEntry.item.name,
        status: differences.length > 0 ? "different" : "identical",
        sourceId: sourceEntry.id,
        targetId: targetEntry.id,
        differences: differences.length > 0 ? differences : undefined,
      });
    }
  }

  return diffs;
}

/**
 * Compare two containers across all resource types.
 */
export async function compareContainers(
  sourceProfile: string,
  targetProfile: string,
  options?: CompareContainersOptions,
): Promise<CompareResult> {
  const [source, target] = await Promise.all([
    options?.sourceState
      ? Promise.resolve(options.sourceState)
      : fetchContainerResources(sourceProfile),
    options?.targetState
      ? Promise.resolve(options.targetState)
      : fetchContainerResources(targetProfile),
  ]);
  const warnings: string[] = [];

  const tags = compareResourceCollections(source.tags, target.tags, (t) => t.tagId, {
    resourceLabel: "tags",
    sourceLabel: sourceProfile,
    targetLabel: targetProfile,
    warnings,
  });
  const triggers = compareResourceCollections(
    source.triggers,
    target.triggers,
    (t) => t.triggerId,
    {
      resourceLabel: "triggers",
      sourceLabel: sourceProfile,
      targetLabel: targetProfile,
      warnings,
    },
  );
  const variables = compareResourceCollections(
    source.variables,
    target.variables,
    (v) => v.variableId,
    {
      resourceLabel: "variables",
      sourceLabel: sourceProfile,
      targetLabel: targetProfile,
      warnings,
    },
  );

  // Summary
  const onlySource = [...tags, ...triggers, ...variables].filter(
    (d) => d.status === "only_in_source",
  ).length;
  const onlyTarget = [...tags, ...triggers, ...variables].filter(
    (d) => d.status === "only_in_target",
  ).length;
  const different = [...tags, ...triggers, ...variables].filter(
    (d) => d.status === "different",
  ).length;
  const identical = [...tags, ...triggers, ...variables].filter(
    (d) => d.status === "identical",
  ).length;

  const summary =
    onlySource + onlyTarget + different === 0
      ? `Containers are identical (${identical} resources match)`
      : `${onlySource} only in ${sourceProfile}, ${onlyTarget} only in ${targetProfile}, ${different} differ, ${identical} identical`;

  return { sourceProfile, targetProfile, tags, triggers, variables, summary, warnings };
}

/**
 * Print a formatted comparison report.
 */
export function printCompareReport(report: CompareResult): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(
    chalk.bold(`  Container Comparison: ${report.sourceProfile} vs ${report.targetProfile}`),
  );
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  if ((report.warnings?.length ?? 0) > 0) {
    console.log(chalk.yellow("  Warnings"));
    for (const warning of report.warnings) {
      console.log(`    - ${warning}`);
    }
    console.log();
  }

  const sections = [
    { label: "Tags", diffs: report.tags },
    { label: "Triggers", diffs: report.triggers },
    { label: "Variables", diffs: report.variables },
  ];

  for (const section of sections) {
    const nonIdentical = section.diffs.filter((d) => d.status !== "identical");
    if (nonIdentical.length === 0) {
      console.log(`  ${chalk.green("✔")} ${chalk.underline(section.label)} — all match\n`);
      continue;
    }

    console.log(
      `  ${chalk.underline(section.label)} (${nonIdentical.length} difference${nonIdentical.length > 1 ? "s" : ""})`,
    );
    for (const diff of nonIdentical) {
      const icon =
        diff.status === "only_in_source"
          ? chalk.yellow("←")
          : diff.status === "only_in_target"
            ? chalk.cyan("→")
            : chalk.red("≠");

      const label =
        diff.status === "only_in_source"
          ? `only in ${report.sourceProfile}`
          : diff.status === "only_in_target"
            ? `only in ${report.targetProfile}`
            : "differs";

      console.log(`    ${icon} ${diff.name} — ${label}`);
      if (diff.differences) {
        for (const d of diff.differences) {
          console.log(`      ${chalk.dim(d)}`);
        }
      }
    }
    console.log();
  }

  console.log(chalk.bold("──────────────────────────────────────────────────"));
  console.log(`  ${report.summary}\n`);
}
