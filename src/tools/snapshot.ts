/**
 * Snapshot — save the full workspace state as a single JSON file.
 *
 * This is the "infrastructure-as-code" foundation. The snapshot captures
 * tags, triggers, variables, folders, built-in variables, environments,
 * clients, and transformations so you can diff, restore, or version-control
 * your GTM configuration.
 *
 * Usage:
 *   npx tsx src/cli.ts snapshot [--output gtm-snapshot.json]
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import {
  getContainer,
  listBuiltInVariables,
  listClients,
  listEnvironments,
  listFolders,
  listTags,
  listTransformations,
  listTriggers,
  listVariables,
} from "../lib/gtm-cli.js";
import { loadConfig } from "../lib/config.js";
import { SnapshotData } from "../types/schemas.js";

export type GtmSnapshot = SnapshotData;

export interface SnapshotMetadataOptions {
  versionId?: string;
  publishedAt?: string;
}

export interface SnapshotResult {
  path: string;
  tagCount: number;
  triggerCount: number;
  variableCount: number;
  folderCount: number;
  builtInVariableCount: number;
  clientCount: number;
  environmentCount: number;
  transformationCount: number;
  timestamp: string;
  sizeBytes: number;
  warning?: string;
}

const LARGE_SNAPSHOT_BYTES = 50 * 1024 * 1024;

type SnapshotFeatureKey =
  | "supportTags"
  | "supportTriggers"
  | "supportVariables"
  | "supportFolders"
  | "supportBuiltInVariables"
  | "supportEnvironments"
  | "supportClients"
  | "supportTransformations";

function supportsFeature(
  container: Awaited<ReturnType<typeof getContainer>>,
  feature: SnapshotFeatureKey,
): boolean {
  return container.features?.[feature] !== false;
}

function listIfSupported<T>(supported: boolean, loader: () => Promise<T[]>): Promise<T[]> {
  return supported ? loader() : Promise.resolve([]);
}

export async function createSnapshot(meta: SnapshotMetadataOptions = {}): Promise<GtmSnapshot> {
  const config = loadConfig();
  const container = await getContainer();
  const [
    tags,
    triggers,
    variables,
    folders,
    builtInVariables,
    environments,
    clients,
    transformations,
  ] = await Promise.all([
    listIfSupported(supportsFeature(container, "supportTags"), listTags),
    listIfSupported(supportsFeature(container, "supportTriggers"), listTriggers),
    listIfSupported(supportsFeature(container, "supportVariables"), listVariables),
    listIfSupported(supportsFeature(container, "supportFolders"), listFolders),
    listIfSupported(supportsFeature(container, "supportBuiltInVariables"), listBuiltInVariables),
    listIfSupported(supportsFeature(container, "supportEnvironments"), listEnvironments),
    listIfSupported(supportsFeature(container, "supportClients"), listClients),
    listIfSupported(supportsFeature(container, "supportTransformations"), listTransformations),
  ]);

  const timestamp = new Date().toISOString();
  return {
    schemaVersion: "1.0",
    meta: {
      timestamp,
      accountId: config.accountId,
      containerId: config.containerId,
      workspaceId: config.workspaceId,
      description: "Auto-generated manual snapshot",
      versionId: meta.versionId,
      publishedAt: meta.publishedAt,
    },
    tags: tags as GtmSnapshot["tags"],
    triggers: triggers as GtmSnapshot["triggers"],
    variables: variables as GtmSnapshot["variables"],
    folders: folders as GtmSnapshot["folders"],
    builtInVariables: builtInVariables as GtmSnapshot["builtInVariables"],
    clients: clients as GtmSnapshot["clients"],
    environments: environments as GtmSnapshot["environments"],
    transformations: transformations as GtmSnapshot["transformations"],
  };
}

export async function takeSnapshot(
  outputPath?: string,
  meta: SnapshotMetadataOptions = {},
): Promise<SnapshotResult> {
  const snapshot = await createSnapshot(meta);
  const filePath = resolve(outputPath ?? "gtm-snapshot.json");
  const serialized = JSON.stringify(snapshot, null, 2) + "\n";
  const sizeBytes = Buffer.byteLength(serialized, "utf8");
  const warning =
    sizeBytes > LARGE_SNAPSHOT_BYTES
      ? `Snapshot is ${Math.ceil(sizeBytes / (1024 * 1024))}MB, which exceeds the recommended 50MB size. Consider pruning or splitting large exports before committing them.`
      : undefined;
  writeFileSync(filePath, serialized);

  return {
    path: filePath,
    tagCount: snapshot.tags.length,
    triggerCount: snapshot.triggers.length,
    variableCount: snapshot.variables.length,
    folderCount: snapshot.folders?.length ?? 0,
    builtInVariableCount: snapshot.builtInVariables?.length ?? 0,
    clientCount: snapshot.clients?.length ?? 0,
    environmentCount: snapshot.environments?.length ?? 0,
    transformationCount: snapshot.transformations?.length ?? 0,
    timestamp: snapshot.meta.timestamp,
    sizeBytes,
    warning,
  };
}

export function printSnapshotResult(result: SnapshotResult): void {
  console.log(chalk.bold("\n  GTM Snapshot Saved\n"));
  console.log(`  ${chalk.green("✔")} File:       ${result.path}`);
  console.log(`  ${chalk.green("✔")} Tags:       ${result.tagCount}`);
  console.log(`  ${chalk.green("✔")} Triggers:   ${result.triggerCount}`);
  console.log(`  ${chalk.green("✔")} Variables:  ${result.variableCount}`);
  console.log(`  ${chalk.green("✔")} Folders:    ${result.folderCount}`);
  console.log(`  ${chalk.green("✔")} Built-Ins:  ${result.builtInVariableCount}`);
  console.log(`  ${chalk.green("✔")} Clients:    ${result.clientCount}`);
  console.log(`  ${chalk.green("✔")} Environments: ${result.environmentCount}`);
  console.log(`  ${chalk.green("✔")} Transformations: ${result.transformationCount}`);
  console.log(`  ${chalk.green("✔")} Timestamp:  ${result.timestamp}`);
  if (result.warning) {
    console.warn(`  ${chalk.yellow("!")} Warning:    ${result.warning}`);
  }
  console.log();
}
