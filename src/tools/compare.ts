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
import { loadConfig } from "../lib/config.js";
import { tagmanager } from "@googleapis/tagmanager";
import { getAuthClient } from "../lib/auth.js";
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

export interface CompareResult {
  sourceProfile: string;
  targetProfile: string;
  tags: ResourceDiff[];
  triggers: ResourceDiff[];
  variables: ResourceDiff[];
  summary: string;
}

export interface ResourceDiff {
  name: string;
  status: "only_in_source" | "only_in_target" | "different" | "identical";
  sourceId?: string;
  targetId?: string;
  differences?: string[];
}

const IGNORED_RESOURCE_KEYS = new Set([
  "tagId",
  "triggerId",
  "variableId",
  "fingerprint",
  "notes",
  "path",
]);

type ComparableValue = any;

/**
 * Fetch all resources from a specific profile's container.
 */
async function fetchContainerResources(profileName: string): Promise<ContainerSnapshot> {
  const config = loadConfig(profileName);
  const auth = await getAuthClient();
  // Type assertion at library boundary — our auth types are runtime-compatible with googleapis
  const gtm = tagmanager({
    version: "v2",
    auth: auth as unknown as Parameters<typeof tagmanager>[0]["auth"],
  });
  const parent = `accounts/${config.accountId}/containers/${config.containerId}/workspaces/${config.workspaceId}`;

  const listTags = async (): Promise<GtmTag[]> => {
    const tags: GtmTag[] = [];
    let pageToken: string | undefined;

    do {
      const res = await gtm.accounts.containers.workspaces.tags.list({ parent, pageToken });
      tags.push(...((res.data.tag as GtmTag[]) || []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return tags;
  };

  const listTriggers = async (): Promise<GtmTrigger[]> => {
    const triggers: GtmTrigger[] = [];
    let pageToken: string | undefined;

    do {
      const res = await gtm.accounts.containers.workspaces.triggers.list({ parent, pageToken });
      triggers.push(...((res.data.trigger as GtmTrigger[]) || []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return triggers;
  };

  const listVariables = async (): Promise<GtmVariable[]> => {
    const variables: GtmVariable[] = [];
    let pageToken: string | undefined;

    do {
      const res = await gtm.accounts.containers.workspaces.variables.list({ parent, pageToken });
      variables.push(...((res.data.variable as GtmVariable[]) || []));
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    return variables;
  };

  const [tags, triggers, variables] = await Promise.all([
    listTags(),
    listTriggers(),
    listVariables(),
  ]);

  return {
    profileName,
    accountId: config.accountId,
    containerId: config.containerId,
    workspaceId: config.workspaceId,
    tags,
    triggers,
    variables,
  };
}

/**
 * Extract a stable matching key from notes when available, falling back to name.
 */
export function getResourceKey(item: { name: string; notes?: string }): string {
  const match = item.notes?.match(/TagOps-ID:\s*([^\n\r]+)/i);
  return match?.[1]?.trim() || item.name;
}

function normalizeComparableValue(value: unknown): ComparableValue {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    const normalized = value.map((item) => normalizeComparableValue(item));
    return normalized.slice().sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .filter(([key]) => !IGNORED_RESOURCE_KEYS.has(key))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, v]) => [key, normalizeComparableValue(v)] as const);
    return Object.fromEntries(entries) as Record<string, ComparableValue>;
  }
  return null;
}

function diffComparableValues(
  source: ComparableValue,
  target: ComparableValue,
  path = "",
): string[] {
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
    const sourceObj = source as Record<string, ComparableValue>;
    const targetObj = target as Record<string, ComparableValue>;
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

  if (JSON.stringify(source) !== JSON.stringify(target)) {
    return [path || "value"];
  }

  return [];
}

export function compareResourceCollections<T extends { name: string; notes?: string }>(
  source: T[],
  target: T[],
  getId: (item: T) => string,
): ResourceDiff[] {
  const diffs: ResourceDiff[] = [];
  const sourceMap = new Map(source.map((s) => [getResourceKey(s), s]));
  const targetMap = new Map(target.map((t) => [getResourceKey(t), t]));

  for (const [key, sourceItem] of sourceMap) {
    const targetItem = targetMap.get(key);
    if (!targetItem) {
      diffs.push({ name: sourceItem.name, status: "only_in_source", sourceId: getId(sourceItem) });
      continue;
    }

    const normalizedSource = normalizeComparableValue(sourceItem);
    const normalizedTarget = normalizeComparableValue(targetItem);
    const differences = diffComparableValues(normalizedSource, normalizedTarget);

    diffs.push({
      name: sourceItem.name,
      status: differences.length > 0 ? "different" : "identical",
      sourceId: getId(sourceItem),
      targetId: getId(targetItem),
      differences: differences.length > 0 ? differences : undefined,
    });
  }

  for (const [key, targetItem] of targetMap) {
    if (!sourceMap.has(key)) {
      diffs.push({ name: targetItem.name, status: "only_in_target", targetId: getId(targetItem) });
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
): Promise<CompareResult> {
  const [source, target] = await Promise.all([
    fetchContainerResources(sourceProfile),
    fetchContainerResources(targetProfile),
  ]);

  const tags = compareResourceCollections(source.tags, target.tags, (t) => t.tagId);
  const triggers = compareResourceCollections(source.triggers, target.triggers, (t) => t.triggerId);
  const variables = compareResourceCollections(
    source.variables,
    target.variables,
    (v) => v.variableId,
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

  return { sourceProfile, targetProfile, tags, triggers, variables, summary };
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
