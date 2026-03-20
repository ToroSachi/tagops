import chalk from "chalk";
import type { GtmVersionHeader } from "../types/gtm.js";
import {
  getLatestPublishedVersion,
  getVersionDetails,
  listVersions,
  rollbackToVersion,
} from "../lib/gtm-cli.js";
import { requirePublishAccess } from "../lib/permission-guard.js";

export interface RollbackChange {
  field: "name" | "description" | "numTags" | "numTriggers" | "numVariables";
  label: string;
  from?: string;
  to?: string;
  changed: boolean;
}

export interface RollbackResult {
  dryRun: boolean;
  versionId: string;
  targetVersion?: GtmVersionHeader;
  currentLiveVersion?: GtmVersionHeader | null;
  publishedVersion?: GtmVersionHeader | null;
  changes: RollbackChange[];
  published: boolean;
  error?: string;
}

export interface VersionHistoryEntry extends GtmVersionHeader {
  isLive: boolean;
  publishedAt?: string;
}

export interface VersionHistoryResult {
  limit: number;
  liveVersionId?: string;
  publishDatesAvailable: boolean;
  versions: VersionHistoryEntry[];
}

function normalizeLimit(limit?: number): number {
  if (!Number.isFinite(limit) || !limit || limit <= 0) return 10;
  return Math.floor(limit);
}

function formatValue(value?: string): string {
  if (value === undefined || value === null || value === "") return "(none)";
  return value;
}

function buildRollbackChanges(
  currentLiveVersion: GtmVersionHeader | null,
  targetVersion: GtmVersionHeader,
): RollbackChange[] {
  const changes: RollbackChange[] = [
    {
      field: "name",
      label: "Version Name",
      from: currentLiveVersion?.name,
      to: targetVersion.name,
      changed: currentLiveVersion?.name !== targetVersion.name,
    },
    {
      field: "description",
      label: "Description",
      from: currentLiveVersion?.description,
      to: targetVersion.description,
      changed: currentLiveVersion?.description !== targetVersion.description,
    },
    {
      field: "numTags",
      label: "Tags",
      from: currentLiveVersion?.numTags,
      to: targetVersion.numTags,
      changed: currentLiveVersion?.numTags !== targetVersion.numTags,
    },
    {
      field: "numTriggers",
      label: "Triggers",
      from: currentLiveVersion?.numTriggers,
      to: targetVersion.numTriggers,
      changed: currentLiveVersion?.numTriggers !== targetVersion.numTriggers,
    },
    {
      field: "numVariables",
      label: "Variables",
      from: currentLiveVersion?.numVariables,
      to: targetVersion.numVariables,
      changed: currentLiveVersion?.numVariables !== targetVersion.numVariables,
    },
  ];

  return changes;
}

export async function rollback(
  versionId: string,
  opts: { dryRun?: boolean } = {},
): Promise<RollbackResult> {
  const result: RollbackResult = {
    dryRun: opts.dryRun ?? false,
    versionId,
    changes: [],
    published: false,
  };

  if (!versionId || versionId.trim().length === 0) {
    result.error = "Version ID is required";
    return result;
  }

  try {
    if (!opts.dryRun) {
      await requirePublishAccess();
    }

    const [targetVersion, currentLiveVersion] = await Promise.all([
      getVersionDetails(versionId),
      getLatestPublishedVersion(),
    ]);

    if (!targetVersion) {
      result.error = `Version ${versionId} was not found`;
      return result;
    }

    result.targetVersion = targetVersion;
    result.currentLiveVersion = currentLiveVersion;
    result.changes = buildRollbackChanges(currentLiveVersion, targetVersion);

    if (opts.dryRun) {
      return result;
    }

    const publishedVersion = await rollbackToVersion(versionId);
    if (!publishedVersion) {
      result.error = `Version ${versionId} could not be published`;
      return result;
    }

    result.published = true;
    result.publishedVersion = publishedVersion;
    return result;
  } catch (err) {
    result.error = (err as Error).message;
    return result;
  }
}

export async function listVersionHistory(limit?: number): Promise<VersionHistoryResult> {
  const normalizedLimit = normalizeLimit(limit);
  const [versions, liveVersion] = await Promise.all([listVersions(), getLatestPublishedVersion()]);
  const recentVersions = versions.slice(0, normalizedLimit);
  const detailedVersions = await Promise.all(
    recentVersions.map(async (version) => {
      const details = await getVersionDetails(version.containerVersionId);
      return details ?? version;
    }),
  );

  return {
    limit: normalizedLimit,
    liveVersionId: liveVersion?.containerVersionId,
    publishDatesAvailable: false,
    versions: detailedVersions.map((version) => ({
      ...version,
      isLive: liveVersion?.containerVersionId === version.containerVersionId,
      publishedAt: undefined,
    })),
  };
}

export function printRollbackResult(result: RollbackResult): void {
  console.log(chalk.bold("\n  GTM Rollback\n"));

  if (result.error) {
    console.log(chalk.red(`  X ${result.error}\n`));
    return;
  }

  console.log(`  Target Version: ${chalk.cyan(result.versionId)}`);
  if (result.targetVersion?.name) {
    console.log(`  Target Name:    ${result.targetVersion.name}`);
  }

  if (result.currentLiveVersion) {
    console.log(
      `  Current Live:   ${chalk.gray(`${result.currentLiveVersion.containerVersionId} (${result.currentLiveVersion.name})`)}`,
    );
  } else {
    console.log(`  Current Live:   ${chalk.gray("(none found)")}`);
  }

  console.log("\n  Change Summary:");
  if (result.changes.every((change) => !change.changed)) {
    console.log(chalk.gray("  - No material differences from the current live version."));
  } else {
    for (const change of result.changes) {
      const color = change.changed ? chalk.yellow : chalk.gray;
      console.log(
        color(`  - ${change.label}: ${formatValue(change.from)} -> ${formatValue(change.to)}`),
      );
    }
  }

  if (result.dryRun) {
    console.log(chalk.yellow("\n  [DRY RUN] No changes were published."));
    console.log(chalk.cyan(`  tagops rollback ${result.versionId}\n`));
    return;
  }

  if (result.published) {
    console.log(chalk.green(`\n  Version ${result.versionId} is now live.\n`));
  }
}

export function printVersionHistory(result: VersionHistoryResult): void {
  console.log(chalk.bold("\n  GTM Version History\n"));

  if (result.versions.length === 0) {
    console.log(chalk.yellow("  No GTM versions were found.\n"));
    return;
  }

  for (const version of result.versions) {
    const liveLabel = version.isLive ? chalk.green("LIVE") : chalk.gray("    ");
    console.log(`  ${liveLabel} ${chalk.cyan(version.containerVersionId)}  ${version.name}`);
    console.log(
      `       Tags ${formatValue(version.numTags)}  Triggers ${formatValue(version.numTriggers)}  Variables ${formatValue(version.numVariables)}`,
    );
    if (version.description) {
      console.log(`       ${chalk.gray(version.description)}`);
    }
    console.log(
      `       Published: ${version.publishedAt ?? (version.isLive ? "current live version" : "not exposed by GTM API")}`,
    );
  }

  if (!result.publishDatesAvailable) {
    console.log(chalk.gray("\n  Note: GTM's API does not expose historical publish timestamps.\n"));
  } else {
    console.log();
  }
}
