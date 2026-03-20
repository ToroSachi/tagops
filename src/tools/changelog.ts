/**
 * Changelog — generate a human-readable changelog between two snapshots.
 *
 * Compares two snapshot files (or a snapshot vs current workspace) and produces
 * a stakeholder-friendly markdown summary of what changed.
 *
 * Usage:
 *   npx tsx src/cli.ts changelog
 *   npx tsx src/cli.ts changelog --from snap-v1.json --to snap-v2.json
 *   npx tsx src/cli.ts changelog --output CHANGELOG.md
 */

import chalk from "chalk";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  listEnvironments,
  listFolders,
  listTags,
  listTriggers,
  listVariables,
} from "../lib/gtm-cli.js";
import { parseSnapshot } from "../types/schemas.js";
import type { GtmSnapshot } from "./snapshot.js";
import type { GtmEnvironment, GtmFolder, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface ChangelogEntry {
  action: "added" | "removed" | "modified" | "paused" | "unpaused";
  resource: "tag" | "trigger" | "variable" | "folder" | "environment";
  name: string;
  id: string;
  details?: string;
}

export interface ChangelogReport {
  fromLabel: string;
  toLabel: string;
  timestamp: string;
  entries: ChangelogEntry[];
  summary: string;
}

function stripTagOpsId(notes?: string): string | undefined {
  if (!notes) return undefined;
  const withoutId = notes
    .replace(/(?:^|\n)\s*TagOps-ID:\s*[a-f0-9-]+\s*(?=\n|$)/gi, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return withoutId.length > 0 ? withoutId : undefined;
}

function loadSnapshotFile(path: string): GtmSnapshot {
  if (!existsSync(path)) {
    throw new Error(`Snapshot not found: ${path}`);
  }
  return parseSnapshot(readFileSync(path, "utf-8")) as GtmSnapshot;
}

/**
 * Compare two sets of resources and return changelog entries.
 */
function diffResources<T extends { name: string }>(
  oldItems: T[],
  newItems: T[],
  getIdentityKey: (item: T) => string,
  getDisplayId: (item: T) => string,
  resourceType: "tag" | "trigger" | "variable" | "folder" | "environment",
  getDetails?: (oldItem: T, newItem: T) => string | undefined,
  getComparable: (item: T) => Record<string, unknown> = (item) => {
    const clone = { ...(item as Record<string, unknown>) };
    delete clone.fingerprint;
    return clone;
  },
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const oldMap = new Map(oldItems.map((i) => [getIdentityKey(i), i]));
  const newMap = new Map(newItems.map((i) => [getIdentityKey(i), i]));

  // Added
  for (const [id, item] of newMap) {
    if (!oldMap.has(id)) {
      entries.push({
        action: "added",
        resource: resourceType,
        name: item.name,
        id: getDisplayId(item),
      });
    }
  }

  // Removed
  for (const [id, item] of oldMap) {
    if (!newMap.has(id)) {
      entries.push({
        action: "removed",
        resource: resourceType,
        name: item.name,
        id: getDisplayId(item),
      });
    }
  }

  // Modified
  for (const [id, newItem] of newMap) {
    const oldItem = oldMap.get(id);
    if (!oldItem) continue;

    // Check for pause/unpause on tags
    if (resourceType === "tag") {
      const oldTag = oldItem as unknown as GtmTag;
      const newTag = newItem as unknown as GtmTag;
      if (!oldTag.paused && newTag.paused) {
        entries.push({ action: "paused", resource: "tag", name: newItem.name, id });
        continue;
      }
      if (oldTag.paused && !newTag.paused) {
        entries.push({ action: "unpaused", resource: "tag", name: newItem.name, id });
        continue;
      }
    }

    // Check for general modifications (skip fingerprint)
    const changedFields: string[] = [];
    const oldComparable = getComparable(oldItem);
    const newComparable = getComparable(newItem);
    const keys = new Set([...Object.keys(oldComparable), ...Object.keys(newComparable)]);
    for (const key of keys) {
      if (JSON.stringify(newComparable[key]) !== JSON.stringify(oldComparable[key])) {
        changedFields.push(key);
      }
    }

    if (changedFields.length > 0) {
      const details = getDetails?.(oldItem, newItem) ?? `Changed: ${changedFields.join(", ")}`;
      entries.push({
        action: "modified",
        resource: resourceType,
        name: newItem.name,
        id: getDisplayId(newItem),
        details,
      });
    }
  }

  return entries;
}

function getTagDetails(oldTag: GtmTag, newTag: GtmTag): string | undefined {
  const parts: string[] = [];

  // Consent changes
  const oldConsent =
    oldTag.consentSettings?.consentType?.list?.map((c) => c.value).join("+") ?? "none";
  const newConsent =
    newTag.consentSettings?.consentType?.list?.map((c) => c.value).join("+") ?? "none";
  if (oldConsent !== newConsent) {
    parts.push(`consent: ${oldConsent} → ${newConsent}`);
  }

  // Trigger changes
  const oldTriggers = (oldTag.firingTriggerId ?? []).sort().join(",");
  const newTriggers = (newTag.firingTriggerId ?? []).sort().join(",");
  if (oldTriggers !== newTriggers) {
    parts.push("triggers changed");
  }

  // Name changes
  if (oldTag.name !== newTag.name) {
    parts.push(`renamed: "${oldTag.name}" → "${newTag.name}"`);
  }

  // HTML changes for custom HTML tags
  if (newTag.type === "html") {
    const oldHtml = oldTag.parameter?.find((p) => p.key === "html")?.value ?? "";
    const newHtml = newTag.parameter?.find((p) => p.key === "html")?.value ?? "";
    if (oldHtml !== newHtml) {
      parts.push("HTML code updated");
    }
  }

  return parts.length > 0 ? parts.join("; ") : undefined;
}

function getFolderDetails(oldFolder: GtmFolder, newFolder: GtmFolder): string | undefined {
  if (stripTagOpsId(oldFolder.notes) !== stripTagOpsId(newFolder.notes)) {
    return "Notes updated";
  }
  return undefined;
}

function getEnvironmentDetails(
  oldEnvironment: GtmEnvironment,
  newEnvironment: GtmEnvironment,
): string | undefined {
  const parts: string[] = [];

  if (oldEnvironment.type !== newEnvironment.type) {
    parts.push(`type: ${oldEnvironment.type} → ${newEnvironment.type}`);
  }

  if ((oldEnvironment.description ?? "") !== (newEnvironment.description ?? "")) {
    parts.push("description updated");
  }

  if ((oldEnvironment.url ?? "") !== (newEnvironment.url ?? "")) {
    parts.push("URL updated");
  }

  return parts.length > 0 ? parts.join("; ") : undefined;
}

function getFolderIdentity(folder: GtmFolder): string {
  return `${folder.folderId}::${folder.name}`;
}

function getEnvironmentIdentity(environment: GtmEnvironment): string {
  return `${environment.environmentId}::${environment.name}`;
}

function normalizeFolder(folder: GtmFolder): Record<string, unknown> {
  return {
    notes: stripTagOpsId(folder.notes) ?? null,
  };
}

function normalizeEnvironment(environment: GtmEnvironment): Record<string, unknown> {
  return {
    description: environment.description ?? null,
    type: environment.type,
    url: environment.url ?? null,
  };
}

/**
 * Generate a changelog between two states.
 */
export async function generateChangelog(opts: {
  from?: string;
  to?: string;
}): Promise<ChangelogReport> {
  let oldTags: GtmTag[];
  let oldTriggers: GtmTrigger[];
  let oldVariables: GtmVariable[];
  let oldFolders: GtmFolder[];
  let oldEnvironments: GtmEnvironment[];
  let fromLabel: string;

  let newTags: GtmTag[];
  let newTriggers: GtmTrigger[];
  let newVariables: GtmVariable[];
  let newFolders: GtmFolder[];
  let newEnvironments: GtmEnvironment[];
  let toLabel: string;

  // Load "from" state
  if (opts.from) {
    const snap = loadSnapshotFile(resolve(opts.from));
    oldTags = snap.tags;
    oldTriggers = snap.triggers;
    oldVariables = snap.variables;
    oldFolders = snap.folders ?? [];
    oldEnvironments = snap.environments ?? [];
    fromLabel = opts.from;
  } else {
    // Default: latest gtm-snapshot.json
    const defaultPath = resolve("gtm-snapshot.json");
    const snap = loadSnapshotFile(defaultPath);
    oldTags = snap.tags;
    oldTriggers = snap.triggers;
    oldVariables = snap.variables;
    oldFolders = snap.folders ?? [];
    oldEnvironments = snap.environments ?? [];
    fromLabel = "gtm-snapshot.json";
  }

  // Load "to" state
  if (opts.to) {
    const snap = loadSnapshotFile(resolve(opts.to));
    newTags = snap.tags;
    newTriggers = snap.triggers;
    newVariables = snap.variables;
    newFolders = snap.folders ?? [];
    newEnvironments = snap.environments ?? [];
    toLabel = opts.to;
  } else {
    // Default: current live workspace
    [newTags, newTriggers, newVariables, newFolders, newEnvironments] = await Promise.all([
      listTags(),
      listTriggers(),
      listVariables(),
      listFolders(),
      listEnvironments(),
    ]);
    toLabel = "current workspace";
  }

  const entries: ChangelogEntry[] = [
    ...diffResources<GtmTag>(
      oldTags,
      newTags,
      (tag) => tag.tagId,
      (tag) => tag.tagId,
      "tag",
      getTagDetails,
    ),
    ...diffResources(
      oldTriggers,
      newTriggers,
      (trigger) => trigger.triggerId,
      (trigger) => trigger.triggerId,
      "trigger",
    ),
    ...diffResources(
      oldVariables,
      newVariables,
      (variable) => variable.variableId,
      (variable) => variable.variableId,
      "variable",
    ),
    ...diffResources(
      oldFolders,
      newFolders,
      getFolderIdentity,
      (folder) => folder.folderId,
      "folder",
      getFolderDetails,
      normalizeFolder,
    ),
    ...diffResources(
      oldEnvironments,
      newEnvironments,
      getEnvironmentIdentity,
      (environment) => environment.environmentId,
      "environment",
      getEnvironmentDetails,
      normalizeEnvironment,
    ),
  ];

  // Build summary
  const added = entries.filter((e) => e.action === "added").length;
  const removed = entries.filter((e) => e.action === "removed").length;
  const modified = entries.filter((e) => e.action === "modified").length;
  const paused = entries.filter((e) => e.action === "paused").length;
  const unpaused = entries.filter((e) => e.action === "unpaused").length;
  const parts: string[] = [];
  if (added) parts.push(`${added} added`);
  if (removed) parts.push(`${removed} removed`);
  if (modified) parts.push(`${modified} modified`);
  if (paused) parts.push(`${paused} paused`);
  if (unpaused) parts.push(`${unpaused} unpaused`);
  const summary = parts.length > 0 ? parts.join(", ") : "No changes";

  return {
    fromLabel,
    toLabel,
    timestamp: new Date().toISOString(),
    entries,
    summary,
  };
}

/**
 * Render the changelog as a clean markdown string.
 */
export function renderChangelogMarkdown(report: ChangelogReport): string {
  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);

  ln(`# GTM Changelog`);
  ln(
    `> Generated ${report.timestamp.split("T")[0]} — comparing **${report.fromLabel}** → **${report.toLabel}**`,
  );
  ln();
  ln(`**Summary:** ${report.summary}`);
  ln();

  if (report.entries.length === 0) {
    ln("No changes detected.");
    return lines.join("\n");
  }

  const icons: Record<string, string> = {
    added: "🟢",
    removed: "🔴",
    modified: "🟡",
    paused: "⏸️",
    unpaused: "▶️",
  };

  // Group by resource type
  for (const resourceType of ["tag", "trigger", "variable", "folder", "environment"] as const) {
    const group = report.entries.filter((e) => e.resource === resourceType);
    if (group.length === 0) continue;

    const heading =
      resourceType === "environment"
        ? "Environments"
        : `${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}s`;
    ln(`## ${heading}`);
    ln();
    for (const entry of group) {
      const icon = icons[entry.action];
      const detail = entry.details ? ` — ${entry.details}` : "";
      ln(`- ${icon} **${entry.action.toUpperCase()}**: ${entry.name} (ID: ${entry.id})${detail}`);
    }
    ln();
  }

  return lines.join("\n");
}

export function printChangelog(report: ChangelogReport): void {
  console.log(chalk.bold("\n  GTM Changelog\n"));
  console.log(`  ${chalk.gray(`${report.fromLabel} → ${report.toLabel}`)}`);
  console.log(`  ${chalk.bold(report.summary)}\n`);

  if (report.entries.length === 0) {
    console.log(chalk.green("  ✔ No changes detected.\n"));
    return;
  }

  const colors: Record<string, (s: string) => string> = {
    added: chalk.green,
    removed: chalk.red,
    modified: chalk.yellow,
    paused: chalk.gray,
    unpaused: chalk.cyan,
  };

  for (const entry of report.entries) {
    const color = colors[entry.action] ?? chalk.white;
    const detail = entry.details ? chalk.gray(` — ${entry.details}`) : "";
    console.log(
      `  ${color(`[${entry.action.toUpperCase()}]`)} [${entry.resource}] ${entry.name}${detail}`,
    );
  }
  console.log();
}
