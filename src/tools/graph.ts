/**
 * Visual Dependency Graph Generator
 *
 * Maps relationships between Tags, Triggers, and Variables,
 * outputting a Mermaid.js flowchart.
 *
 * Usage:
 *   npx tsx src/cli.ts graph
 *   npx tsx src/cli.ts graph --output gtm-graph.md
 */

import chalk from "chalk";
import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import { BUILTIN_TRIGGER_IDS } from "../lib/architecture.js";
import type { GtmSnapshot } from "./snapshot.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface GraphReport {
  source: string;
  outputPath: string;
  nodeCount: number;
  edgeCount: number;
}

/**
 * Sanitize strings for Mermaid.js node labels.
 * Removes quotes and specific characters that break Mermaid syntax.
 */
function sanitize(text: string): string {
  return text.replace(/["[\]]/g, "").trim();
}

/**
 * Extract variable references (e.g., {{DLV - Value}}) from an object.
 */
function extractVariableRefs(obj: unknown): Set<string> {
  const allJson = JSON.stringify(obj);
  const re = /\{\{([^}]+)\}\}/g;
  const refs = new Set<string>();
  let match: RegExpExecArray | null;
  while ((match = re.exec(allJson)) !== null) {
    refs.add(match[1]);
  }
  return refs;
}

export async function generateGraph(opts: {
  snapshot?: string;
  output?: string;
}): Promise<GraphReport> {
  let tags: GtmTag[];
  let triggers: GtmTrigger[];
  let variables: GtmVariable[];
  let sourceLabel: string;

  if (opts.snapshot) {
    const filePath = resolve(opts.snapshot);
    if (!existsSync(filePath)) {
      throw new Error(`Snapshot not found: ${filePath}`);
    }
    const snap = JSON.parse(readFileSync(filePath, "utf-8")) as GtmSnapshot;
    tags = snap.tags;
    triggers = snap.triggers;
    variables = snap.variables;
    sourceLabel = opts.snapshot;
  } else {
    tags = await listTags();
    triggers = await listTriggers();
    variables = await listVariables();
    sourceLabel = "Live Workspace";

    if (tags.length === 0 && triggers.length === 0) {
      throw new Error("Cannot connect to GTM. Run: tagops auth login");
    }
  }

  const lines: string[] = [];
  const ln = (s = "") => lines.push(s);

  // Markdown wrapper
  ln("# GTM Dependency Graph");
  ln(`> Source: **${sourceLabel}**`);
  ln();
  ln("```mermaid");
  ln("flowchart LR");

  // Styling
  ln("  classDef tag fill:#e1f5fe,stroke:#0288d1,stroke-width:2px;");
  ln("  classDef trigger fill:#fff3e0,stroke:#f57c00,stroke-width:2px;");
  ln("  classDef variable fill:#e8f5e9,stroke:#388e3c,stroke-width:2px;");
  ln("  classDef paused stroke-dasharray: 5 5;");
  ln();

  let nodeCount = 0;
  let edgeCount = 0;

  // Nodes Tracking
  const renderedTriggers = new Set<string>();
  const renderedVariables = new Set<string>();

  // Track variables referenced by triggers
  const triggerRefs = new Map<string, Set<string>>();
  for (const trig of triggers) {
    triggerRefs.set(trig.triggerId, extractVariableRefs(trig));
  }

  // Tags
  ln("  %% Tags");
  for (const tag of tags) {
    const tNode = `tag_${tag.tagId}`;
    const pausedClass = tag.paused ? " paused" : "";
    ln(`  ${tNode}["🏷️ ${sanitize(tag.name)}"]:::tag${pausedClass}`);
    nodeCount++;

    // Tag -> Trigger connections
    for (const trigId of tag.firingTriggerId ?? []) {
      const trigNode = `trig_${trigId}`;
      ln(`  ${trigNode} --> |fires| ${tNode}`);
      edgeCount++;
      renderedTriggers.add(trigId);
    }

    // Tag -> Variable connections
    const varRefs = extractVariableRefs(tag.parameter);
    for (const vName of varRefs) {
      // Find the variable ID by name
      const variable = variables.find((v) => v.name === vName);
      if (variable) {
        const vNode = `var_${variable.variableId}`;
        ln(`  ${vNode} -.-> |used in| ${tNode}`);
        edgeCount++;
        renderedVariables.add(variable.variableId);
      }
    }
  }

  ln();
  ln("  %% Triggers");
  for (const trigId of renderedTriggers) {
    if (BUILTIN_TRIGGER_IDS.has(trigId)) {
      // Built-in triggers (like "All Pages") don't exist in the triggers API response usually
      ln(`  trig_${trigId}["⚡ Built-in Event"]:::trigger`);
      nodeCount++;
      continue;
    }

    const trigger = triggers.find((t) => t.triggerId === trigId);
    if (trigger) {
      ln(`  trig_${trigId}["⚡ ${sanitize(trigger.name)}"]:::trigger`);
      nodeCount++;

      // Trigger -> Variable connections
      const refs = triggerRefs.get(trigger.triggerId) ?? new Set();
      for (const vName of refs) {
        const variable = variables.find((v) => v.name === vName);
        if (variable) {
          const vNode = `var_${variable.variableId}`;
          ln(`  ${vNode} -.-> |evaluated| trig_${trigId}`);
          edgeCount++;
          renderedVariables.add(variable.variableId);
        }
      }
    } else {
      ln(`  trig_${trigId}["⚡ Unknown Trigger (${trigId})"]:::trigger`);
      nodeCount++;
    }
  }

  ln();
  ln("  %% Variables");
  for (const varId of renderedVariables) {
    const variable = variables.find((v) => v.variableId === varId);
    if (variable) {
      ln(`  var_${varId}["📦 ${sanitize(variable.name)}"]:::variable`);
      nodeCount++;
    }
  }

  ln("```");

  const md = lines.join("\n");
  const outputPath = resolve(opts.output ?? "gtm-graph.md");
  writeFileSync(outputPath, md);

  return {
    source: sourceLabel,
    outputPath,
    nodeCount,
    edgeCount,
  };
}

export function printGraphReport(report: GraphReport): void {
  console.log(chalk.bold("\n  GTM Dependency Graph Generated\n"));
  console.log(`  Source: ${chalk.gray(report.source)}`);
  console.log(`  Nodes:  ${report.nodeCount}`);
  console.log(`  Edges:  ${report.edgeCount}\n`);
  console.log(`  ${chalk.green(`✔ Saved to ${report.outputPath}`)}\n`);

  console.log(chalk.gray("  Tip: View the markdown file in VS Code or GitHub to automatically"));
  console.log(chalk.gray("       render the Mermaid.js flowchart.\n"));
}
