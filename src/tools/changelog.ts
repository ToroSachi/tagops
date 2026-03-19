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
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import type { GtmSnapshot } from "./snapshot.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface ChangelogEntry {
  action: "added" | "removed" | "modified" | "paused" | "unpaused";
  resource: "tag" | "trigger" | "variable";
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

function loadSnapshotFile(path: string): GtmSnapshot {
  if (!existsSync(path)) {
    throw new Error(`Snapshot not found: ${path}`);
  }
  return JSON.parse(readFileSync(path, "utf-8")) as GtmSnapshot;
}

/**
 * Compare two sets of resources and return changelog entries.
 */
function diffResources<T extends { name: string }>(
  oldItems: T[],
  newItems: T[],
  idKey: keyof T,
  resourceType: "tag" | "trigger" | "variable",
  getDetails?: (oldItem: T, newItem: T) => string | undefined,
): ChangelogEntry[] {
  const entries: ChangelogEntry[] = [];
  const oldMap = new Map(oldItems.map((i) => [String(i[idKey]), i]));
  const newMap = new Map(newItems.map((i) => [String(i[idKey]), i]));

  // Added
  for (const [id, item] of newMap) {
    if (!oldMap.has(id)) {
      entries.push({ action: "added", resource: resourceType, name: item.name, id });
    }
  }

  // Removed
  for (const [id, item] of oldMap) {
    if (!newMap.has(id)) {
      entries.push({ action: "removed", resource: resourceType, name: item.name, id });
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
    for (const key of Object.keys(newItem) as (keyof T)[]) {
      if (key === ("fingerprint" as keyof T)) continue;
      if (JSON.stringify(newItem[key]) !== JSON.stringify(oldItem[key])) {
        changedFields.push(String(key));
      }
    }

    if (changedFields.length > 0) {
      const details = getDetails?.(oldItem, newItem) ?? `Changed: ${changedFields.join(", ")}`;
      entries.push({ action: "modified", resource: resourceType, name: newItem.name, id, details });
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
  let fromLabel: string;

  let newTags: GtmTag[];
  let newTriggers: GtmTrigger[];
  let newVariables: GtmVariable[];
  let toLabel: string;

  // Load "from" state
  if (opts.from) {
    const snap = loadSnapshotFile(resolve(opts.from));
    oldTags = snap.tags;
    oldTriggers = snap.triggers;
    oldVariables = snap.variables;
    fromLabel = opts.from;
  } else {
    // Default: latest gtm-snapshot.json
    const defaultPath = resolve("gtm-snapshot.json");
    const snap = loadSnapshotFile(defaultPath);
    oldTags = snap.tags;
    oldTriggers = snap.triggers;
    oldVariables = snap.variables;
    fromLabel = "gtm-snapshot.json";
  }

  // Load "to" state
  if (opts.to) {
    const snap = loadSnapshotFile(resolve(opts.to));
    newTags = snap.tags;
    newTriggers = snap.triggers;
    newVariables = snap.variables;
    toLabel = opts.to;
  } else {
    // Default: current live workspace
    newTags = await listTags();
    newTriggers = await listTriggers();
    newVariables = await listVariables();
    toLabel = "current workspace";
  }

  const entries: ChangelogEntry[] = [
    ...diffResources<GtmTag>(oldTags, newTags, "tagId", "tag", getTagDetails),
    ...diffResources(oldTriggers, newTriggers, "triggerId" as keyof GtmTrigger, "trigger"),
    ...diffResources(oldVariables, newVariables, "variableId" as keyof GtmVariable, "variable"),
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
  for (const resourceType of ["tag", "trigger", "variable"] as const) {
    const group = report.entries.filter((e) => e.resource === resourceType);
    if (group.length === 0) continue;

    ln(`## ${resourceType.charAt(0).toUpperCase() + resourceType.slice(1)}s`);
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
