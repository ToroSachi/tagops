/**
 * GTM Auto-Documentation Generator
 *
 * Generates a comprehensive markdown data dictionary from the live GTM workspace.
 * Covers tags, triggers, variables, data layer spec, and consent map.
 *
 * Usage:
 *   npx tsx src/cli.ts docgen
 *   npx tsx src/cli.ts docgen --output gtm-docs.md
 */

import chalk from "chalk";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import { BUILTIN_TRIGGER_IDS, TAG_TYPES, VARIABLE_TYPES } from "../lib/architecture.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface DocgenResult {
  outputPath: string;
  tagCount: number;
  triggerCount: number;
  variableCount: number;
  dataLayerKeys: string[];
}

/**
 * Build a trigger usage map: triggerId → list of tag names that use it.
 */
function buildTriggerUsage(tags: GtmTag[]): Map<string, string[]> {
  const usage = new Map<string, string[]>();
  for (const tag of tags) {
    for (const tid of tag.firingTriggerId ?? []) {
      const list = usage.get(tid) ?? [];
      list.push(tag.name);
      usage.set(tid, list);
    }
  }
  return usage;
}

/**
 * Extract Data Layer keys referenced across all tags and variables as {{DLV - ...}} patterns.
 */
function extractDataLayerKeys(tags: GtmTag[], variables: GtmVariable[]): string[] {
  const allJson = JSON.stringify(tags) + JSON.stringify(variables);
  const re = /\{\{DLV - ([^}]+)\}\}/g;
  const keys = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(allJson)) !== null) {
    keys.add(match[1]);
  }
  return [...keys].sort();
}

/**
 * Extract all GTM variable references used across tags.
 */
function extractVariableReferences(tags: GtmTag[]): Set<string> {
  const allJson = JSON.stringify(tags);
  const re = /\{\{([^}]+)\}\}/g;
  const refs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(allJson)) !== null) {
    refs.add(match[1]);
  }
  return refs;
}

/**
 * Generate a complete markdown document of the GTM workspace.
 */
export function generateDocumentation(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variables: GtmVariable[],
): string {
  const triggerUsage = buildTriggerUsage(tags);
  const dataLayerKeys = extractDataLayerKeys(tags, variables);
  const varRefs = extractVariableReferences(tags);
  const now = new Date().toISOString().split("T")[0];

  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);

  // ── Header ──
  ln("# GTM Workspace Data Dictionary");
  ln(`> Auto-generated on ${now} by \`tagops docgen\``);
  ln();
  ln(`| Metric | Count |`);
  ln(`|--------|-------|`);
  ln(`| Tags | ${tags.length} |`);
  ln(`| Triggers | ${triggers.length} |`);
  ln(`| Variables | ${variables.length} |`);
  ln(`| Data Layer Keys | ${dataLayerKeys.length} |`);
  ln();
  ln("---");

  // ── Tags ──
  ln();
  ln("## Tags");
  ln();
  ln("| ID | Name | Type | Triggers | Consent | Status |");
  ln("|----|------|------|----------|---------|--------|");

  const sortedTags = [...tags].sort((a, b) => a.name.localeCompare(b.name));
  for (const tag of sortedTags) {
    const typeName = TAG_TYPES[tag.type] ?? tag.type;
    const triggerNames = (tag.firingTriggerId ?? [])
      .map((tid) => {
        const t = triggers.find((tr) => tr.triggerId === tid);
        return t?.name ?? `#${tid}`;
      })
      .join(", ");
    const consentValues =
      tag.consentSettings?.consentType?.list?.map((c) => c.value).join(", ") ?? "—";
    const status = tag.paused ? "⏸ Paused" : "✅ Active";

    ln(
      `| ${tag.tagId} | ${tag.name} | ${typeName} | ${triggerNames || "—"} | ${consentValues} | ${status} |`,
    );
  }

  // ── Triggers ──
  ln();
  ln("---");
  ln();
  ln("## Triggers");
  ln();
  ln("| ID | Name | Type | Event | Used By |");
  ln("|----|------|------|-------|---------|");

  const sortedTriggers = [...triggers].sort((a, b) => a.name.localeCompare(b.name));
  for (const trigger of sortedTriggers) {
    if (BUILTIN_TRIGGER_IDS.has(trigger.triggerId)) continue;
    const eventName =
      trigger.customEventFilter?.[0]?.parameter?.find((p) => p.key === "arg1")?.value ?? "—";
    const usedBy = triggerUsage.get(trigger.triggerId)?.join(", ") ?? "⚠️ Unused";
    ln(`| ${trigger.triggerId} | ${trigger.name} | ${trigger.type} | ${eventName} | ${usedBy} |`);
  }

  // ── Variables ──
  ln();
  ln("---");
  ln();
  ln("## Variables");
  ln();
  ln("| ID | Name | Type | Referenced |");
  ln("|----|------|------|------------|");

  const sortedVars = [...variables].sort((a, b) => a.name.localeCompare(b.name));
  for (const v of sortedVars) {
    const typeName = VARIABLE_TYPES[v.type] ?? v.type;
    const isReferenced = varRefs.has(v.name) ? "✅ Yes" : "⚠️ No";
    ln(`| ${v.variableId} | ${v.name} | ${typeName} | ${isReferenced} |`);
  }

  // ── Data Layer Spec ──
  ln();
  ln("---");
  ln();
  ln("## Data Layer Specification");
  ln();
  ln("The following Data Layer keys are expected by this GTM container. Ensure your");
  ln("website pushes these keys to `window.dataLayer` for proper tracking.");
  ln();
  ln("| # | Data Layer Key | GTM Variable Name |");
  ln("|---|---------------|-------------------|");
  dataLayerKeys.forEach((key, i) => {
    ln(`| ${i + 1} | \`${key}\` | \`DLV - ${key}\` |`);
  });

  // ── Consent Map ──
  ln();
  ln("---");
  ln();
  ln("## Consent Map");
  ln();
  ln("Shows which consent type each active tag requires.");
  ln();

  const consentGroups = new Map<string, string[]>();
  for (const tag of tags) {
    if (tag.paused) continue;
    const consent = tag.consentSettings?.consentType?.list?.map((c) => c.value).join("+") ?? "none";
    const list = consentGroups.get(consent) ?? [];
    list.push(tag.name);
    consentGroups.set(consent, list);
  }

  for (const [consent, tagNames] of consentGroups) {
    ln(`### \`${consent}\``);
    for (const name of tagNames.sort()) {
      ln(`- ${name}`);
    }
    ln();
  }

  return lines.join("\n");
}

/**
 * Generate docs from the live workspace and write to file.
 */
export async function generateDocs(outputPath?: string): Promise<DocgenResult> {
  const tags = await listTags();
  const triggers = await listTriggers();
  const variables = await listVariables();

  if (tags.length === 0 && triggers.length === 0 && variables.length === 0) {
    throw new Error("Cannot connect to GTM or workspace is empty.");
  }

  const markdown = generateDocumentation(tags, triggers, variables);
  const dataLayerKeys = extractDataLayerKeys(tags, variables);

  const output = resolve(outputPath ?? "gtm-dictionary.md");
  writeFileSync(output, markdown);

  return {
    outputPath: output,
    tagCount: tags.length,
    triggerCount: triggers.length,
    variableCount: variables.length,
    dataLayerKeys,
  };
}

export function printDocgenResult(result: DocgenResult): void {
  console.log(chalk.bold("\n=== GTM Documentation Generated ===\n"));
  console.log(`  📄 Output: ${chalk.cyan(result.outputPath)}`);
  console.log(`  🏷  Tags: ${result.tagCount}`);
  console.log(`  ⚡ Triggers: ${result.triggerCount}`);
  console.log(`  📦 Variables: ${result.variableCount}`);
  console.log(`  📋 Data Layer Keys: ${result.dataLayerKeys.length}`);
  console.log();
}
