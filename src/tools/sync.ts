/**
 * TagOps Sync Engine
 *
 * Syncs specific changes from a "source" profile to a "target" profile.
 * Intelligently maps Variable IDs inside Triggers and Trigger IDs inside Tags
 * across different containers so dependencies don't break.
 */

import chalk from "chalk";
import { type GtmTag, type GtmTrigger, type GtmVariable } from "../types/gtm.js";
import { loadConfig } from "../lib/config.js";
import {
  createVariable,
  updateVariable,
  createTrigger,
  updateTrigger,
  createTag,
  updateTag,
  getGtmClient,
} from "../lib/gtm-cli.js";
import { compareContainers } from "./compare.js";
import * as readline from "node:readline";

type SyncTag = GtmTag & {
  notes?: string;
  parameter?: any[];
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  consentSettings?: GtmTag["consentSettings"];
  tagFiringOption?: string;
  paused?: boolean;
  parentFolderId?: string;
};

type SyncTrigger = GtmTrigger & {
  notes?: string;
  parameter?: any[];
  filter?: any[];
  customEventFilter?: any[];
  parentFolderId?: string;
};

type SyncVariable = GtmVariable & {
  notes?: string;
  parameter?: any[];
  parentFolderId?: string;
};

export interface SyncOptions {
  source: string;
  target: string;
  dryRun?: boolean;
  force?: boolean;
}

export interface SyncResult {
  variablesCreated: number;
  variablesUpdated: number;
  triggersCreated: number;
  triggersUpdated: number;
  tagsCreated: number;
  tagsUpdated: number;
  errors: string[];
}

function askConfirmation(question: string): Promise<boolean> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

/**
 * Fetch a single container's full state
 */
async function fetchFullState(profileName: string): Promise<{
  tags: SyncTag[];
  triggers: SyncTrigger[];
  variables: SyncVariable[];
}> {
  const config = loadConfig(profileName);
  const gtm = await getGtmClient();
  const parent = `accounts/${config.accountId}/containers/${config.containerId}/workspaces/${config.workspaceId}`;

  const [tagsRes, triggersRes, variablesRes] = await Promise.all([
    gtm.accounts.containers.workspaces.tags.list({ parent }),
    gtm.accounts.containers.workspaces.triggers.list({ parent }),
    gtm.accounts.containers.workspaces.variables.list({ parent }),
  ]);

  return {
    tags: (tagsRes.data.tag as SyncTag[]) || [],
    triggers: (triggersRes.data.trigger as SyncTrigger[]) || [],
    variables: (variablesRes.data.variable as SyncVariable[]) || [],
  };
}

/**
 * Deeply maps variable references in trigger filters from source IDs to target IDs.
 */
export function mapVariablesInTrigger(
  trigger: SyncTrigger,
  sourceVars: SyncVariable[],
  targetVars: SyncVariable[],
): SyncTrigger {
  const cloned = JSON.parse(JSON.stringify(trigger)) as SyncTrigger;
  const remapTemplateValue = (value: string): string => {
    if (value.startsWith("{{") && value.endsWith("}}")) {
      const varName = value.slice(2, -2);
      const targetVar = targetVars.find((v) => v.name === varName);
      return targetVar ? `{{${targetVar.name}}}` : value;
    }

    if (/^[0-9]+$/.test(value)) {
      const srcVar = sourceVars.find((v) => v.variableId === value);
      if (srcVar) {
        const targetVar = targetVars.find((v) => v.name === srcVar.name);
        return targetVar?.variableId ?? value;
      }
    }

    return value;
  };

  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) {
      return node.map((item) => walk(item));
    }

    if (!node || typeof node !== "object") {
      return node;
    }

    const record = node as Record<string, unknown>;
    const next: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(record)) {
      if (key === "value" && record.type === "template" && typeof value === "string") {
        next[key] = remapTemplateValue(value);
      } else {
        next[key] = walk(value);
      }
    }

    return next;
  };

  return walk(cloned) as SyncTrigger;
}

function getNotes(sourceNotes?: string, targetNotes?: string): string | undefined {
  return targetNotes ?? sourceNotes;
}

function buildVariableRequestBody(
  variable: SyncVariable,
  targetVariable?: SyncVariable,
): Record<string, unknown> {
  return {
    parameter: variable.parameter,
    parentFolderId: variable.parentFolderId,
    notes: getNotes(variable.notes, targetVariable?.notes),
  };
}

function buildTriggerRequestBody(
  trigger: SyncTrigger,
  sourceVars: SyncVariable[],
  targetVars: SyncVariable[],
  targetTrigger?: SyncTrigger,
): Record<string, unknown> {
  const mappedTrigger = mapVariablesInTrigger(trigger, sourceVars, targetVars);
  return {
    customEventFilter: mappedTrigger.customEventFilter,
    filter: mappedTrigger.filter,
    parameter: mappedTrigger.parameter,
    parentFolderId: mappedTrigger.parentFolderId,
    notes: getNotes(mappedTrigger.notes, targetTrigger?.notes),
  };
}

function buildTagRequestBody(
  tag: SyncTag,
  blockingTriggerId: string[] | undefined,
  targetTag?: SyncTag,
): Record<string, unknown> {
  return {
    parameter: tag.parameter,
    consentSettings: tag.consentSettings,
    paused: tag.paused,
    parentFolderId: tag.parentFolderId,
    tagFiringOption: tag.tagFiringOption,
    blockingTriggerId,
    notes: getNotes(tag.notes, targetTag?.notes),
  };
}

export async function syncContainers(opts: SyncOptions): Promise<SyncResult> {
  console.log(chalk.bold(`\n🔄 TagOps Sync — connecting to ${opts.source} → ${opts.target}...`));

  const [sourceState, targetState] = await Promise.all([
    fetchFullState(opts.source),
    fetchFullState(opts.target),
  ]);

  const report = await compareContainers(opts.source, opts.target);

  const variablesToCreate = report.variables.filter((v) => v.status === "only_in_source");
  const variablesToUpdate = report.variables.filter((v) => v.status === "different");

  const triggersToCreate = report.triggers.filter((t) => t.status === "only_in_source");
  const triggersToUpdate = report.triggers.filter((t) => t.status === "different");

  const tagsToCreate = report.tags.filter((t) => t.status === "only_in_source");
  const tagsToUpdate = report.tags.filter((t) => t.status === "different");

  const totalActions =
    variablesToCreate.length +
    variablesToUpdate.length +
    triggersToCreate.length +
    triggersToUpdate.length +
    tagsToCreate.length +
    tagsToUpdate.length;

  if (totalActions === 0) {
    console.log(chalk.green(`\n✔ ${opts.target} is already in sync with ${opts.source}.`));
    return {
      variablesCreated: 0,
      variablesUpdated: 0,
      triggersCreated: 0,
      triggersUpdated: 0,
      tagsCreated: 0,
      tagsUpdated: 0,
      errors: [],
    };
  }

  console.log(chalk.yellow(`\nSync required (${totalActions} actions):`));
  if (variablesToCreate.length || variablesToUpdate.length)
    console.log(
      `  Variables: ${variablesToCreate.length} create, ${variablesToUpdate.length} update`,
    );
  if (triggersToCreate.length || triggersToUpdate.length)
    console.log(
      `  Triggers:  ${triggersToCreate.length} create, ${triggersToUpdate.length} update`,
    );
  if (tagsToCreate.length || tagsToUpdate.length)
    console.log(`  Tags:      ${tagsToCreate.length} create, ${tagsToUpdate.length} update`);

  if (!opts.force && !opts.dryRun) {
    if (!(await askConfirmation(`\nProceed with sync? (y/N): `))) {
      return {
        variablesCreated: 0,
        variablesUpdated: 0,
        triggersCreated: 0,
        triggersUpdated: 0,
        tagsCreated: 0,
        tagsUpdated: 0,
        errors: ["Sync aborted by user."],
      };
    }
  }

  if (opts.dryRun) {
    console.log(chalk.cyan("\n[DRY RUN] No changes made."));
    return {
      variablesCreated: 0,
      variablesUpdated: 0,
      triggersCreated: 0,
      triggersUpdated: 0,
      tagsCreated: 0,
      tagsUpdated: 0,
      errors: [],
    };
  }

  const result: SyncResult = {
    variablesCreated: 0,
    variablesUpdated: 0,
    triggersCreated: 0,
    triggersUpdated: 0,
    tagsCreated: 0,
    tagsUpdated: 0,
    errors: [],
  };

  const currentTargetTags = [...targetState.tags];
  const currentTargetVariables = [...targetState.variables];
  const currentTargetTriggers = [...targetState.triggers];

  // 1. SYNC VARIABLES
  console.log(chalk.bold(`\nSyncing Variables...`));
  for (const diff of [...variablesToCreate, ...variablesToUpdate]) {
    try {
      const sourceVar = sourceState.variables.find((v) => v.variableId === diff.sourceId);
      if (!sourceVar) continue;

      const targetVar = currentTargetVariables.find((v) => v.variableId === diff.targetId);
      const config = buildVariableRequestBody(sourceVar, targetVar);

      if (diff.status === "only_in_source") {
        const res = await createVariable(sourceVar.name, sourceVar.type, config);
        if (res) {
          currentTargetVariables.push(res);
          result.variablesCreated++;
          console.log(`  ${chalk.green("+")} Created: ${sourceVar.name}`);
        }
      } else {
        const res = await updateVariable(diff.targetId!, {
          ...config,
          name: sourceVar.name,
          type: sourceVar.type,
        });
        if (res) {
          const idx = currentTargetVariables.findIndex((v) => v.variableId === diff.targetId);
          if (idx !== -1) currentTargetVariables[idx] = res;
          result.variablesUpdated++;
          console.log(`  ${chalk.cyan("~")} Updated: ${sourceVar.name}`);
        }
      }
    } catch (err: any) {
      result.errors.push(err.message);
      console.log(`  ${chalk.red("✖")} ${diff.name}: ${err.message}`);
    }
  }

  // 2. SYNC TRIGGERS
  console.log(chalk.bold(`\nSyncing Triggers...`));
  for (const diff of [...triggersToCreate, ...triggersToUpdate]) {
    try {
      const sourceTrigger = sourceState.triggers.find((t) => t.triggerId === diff.sourceId);
      if (!sourceTrigger) continue;

      const targetTrigger = currentTargetTriggers.find((t) => t.triggerId === diff.targetId);
      const mappedTrigger = mapVariablesInTrigger(
        sourceTrigger,
        sourceState.variables,
        currentTargetVariables,
      );
      const config = buildTriggerRequestBody(
        sourceTrigger,
        sourceState.variables,
        currentTargetVariables,
        targetTrigger,
      );

      if (diff.status === "only_in_source") {
        const res = await createTrigger(mappedTrigger.name, mappedTrigger.type, config);
        if (res) {
          currentTargetTriggers.push(res);
          result.triggersCreated++;
          console.log(`  ${chalk.green("+")} Created: ${mappedTrigger.name}`);
        }
      } else {
        const res = await updateTrigger(diff.targetId!, {
          ...config,
          name: mappedTrigger.name,
          type: mappedTrigger.type,
        });
        if (res) {
          const idx = currentTargetTriggers.findIndex((t) => t.triggerId === diff.targetId);
          if (idx !== -1) currentTargetTriggers[idx] = res;
          result.triggersUpdated++;
          console.log(`  ${chalk.cyan("~")} Updated: ${mappedTrigger.name}`);
        }
      }
    } catch (err: any) {
      result.errors.push(err.message);
      console.log(`  ${chalk.red("✖")} Trigger ${diff.name}: ${err.message}`);
    }
  }

  // 3. SYNC TAGS
  console.log(chalk.bold(`\nSyncing Tags...`));
  for (const diff of [...tagsToCreate, ...tagsToUpdate]) {
    try {
      const sourceTag = sourceState.tags.find((t) => t.tagId === diff.sourceId);
      if (!sourceTag) continue;
      const targetTag = currentTargetTags.find((t) => t.tagId === diff.targetId);

      // ID Mapping: Triggers -> Tags
      const mapIds = (ids?: string[]) =>
        ids?.map((sid) => {
          const sName = sourceState.triggers.find((t) => t.triggerId === sid)?.name;
          return currentTargetTriggers.find((t) => t.name === sName)?.triggerId || sid;
        });

      const firingTriggerId = mapIds(sourceTag.firingTriggerId);
      const blockingTriggerId = mapIds(sourceTag.blockingTriggerId);
      const config = buildTagRequestBody(sourceTag, blockingTriggerId, targetTag);

      if (diff.status === "only_in_source") {
        await createTag({
          name: sourceTag.name,
          type: sourceTag.type,
          firingTriggerId,
          config,
        });
        result.tagsCreated++;
        console.log(`  ${chalk.green("+")} Created: ${sourceTag.name}`);
      } else {
        await updateTag({
          tagId: diff.targetId!,
          name: sourceTag.name,
          fingerprint: targetTag?.fingerprint || "",
          firingTriggerId,
          config,
        });
        result.tagsUpdated++;
        console.log(`  ${chalk.cyan("~")} Updated: ${sourceTag.name}`);
      }
    } catch (err: any) {
      result.errors.push(err.message);
      console.log(`  ${chalk.red("✖")} Tag ${diff.name}: ${err.message}`);
    }
  }

  console.log(
    chalk.bold(
      result.errors.length
        ? `\nSync completed with ${result.errors.length} errors.`
        : `\n✨ Sync complete! ${totalActions} resources updated.`,
    ),
  );
  return result;
}
