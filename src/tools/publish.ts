/**
 * Publish — create and publish a GTM workspace version.
 *
 * This is the final step in the GTM lifecycle. Creates a new container version
 * from the current workspace, optionally publishes it live, with safety rails.
 *
 * Usage:
 *   npx tsx src/cli.ts publish --name "v1.5 — Meta Pixel Fix"
 *   npx tsx src/cli.ts publish --name "v1.5" --description "Fixed Meta consent" --confirm
 *   npx tsx src/cli.ts publish --name "v1.5" --dry-run
 */

import chalk from "chalk";
import { createVersion, publishVersion, listVersions } from "../lib/gtm-cli.js";

export interface VersionInfo {
  containerVersionId: string;
  name: string;
  description?: string;
  fingerprint?: string;
}

export interface PublishResult {
  dryRun: boolean;
  versionName: string;
  versionDescription: string;
  versionId?: string;
  published: boolean;
  error?: string;
}

// Now imported directly from gtm-cli.ts

/**
 * Full publish workflow with safety rails.
 */
export async function runPublish(opts: {
  name: string;
  description?: string;
  confirm?: boolean;
  dryRun?: boolean;
}): Promise<PublishResult> {
  const result: PublishResult = {
    dryRun: opts.dryRun ?? false,
    versionName: opts.name,
    versionDescription: opts.description ?? "",
    published: false,
  };

  if (!opts.name) {
    result.error = "Version name is required";
    return result;
  }

  if (opts.dryRun) {
    return result;
  }

  // Step 1: Create the version
  try {
    const version = await createVersion(opts.name, opts.description);
    if (!version) {
      result.error = "Failed to create version — GTM CLI returned empty response";
      return result;
    }
    result.versionId = version.containerVersionId;
  } catch (err) {
    result.error = `Failed to create version: ${(err as Error).message}`;
    return result;
  }

  // Step 2: Publish if --confirm was passed
  if (opts.confirm && result.versionId) {
    try {
      const published = await publishVersion(result.versionId);
      result.published = published;
      if (!published) {
        result.error = "Version created but publish failed";
      }
    } catch (err) {
      result.error = `Version created but publish failed: ${(err as Error).message}`;
    }
  }

  return result;
}

export function printPublishResult(result: PublishResult): void {
  console.log(chalk.bold("\n  GTM Publish\n"));

  if (result.dryRun) {
    console.log(chalk.yellow("  [DRY RUN] — No changes will be made.\n"));
    console.log(`  Version Name:  ${chalk.cyan(result.versionName)}`);
    console.log(`  Description:   ${result.versionDescription || "(none)"}`);
    console.log();
    console.log("  To create and publish for real:");
    console.log(chalk.cyan(`    tagops publish --name "${result.versionName}" --confirm\n`));
    return;
  }

  if (result.error) {
    console.log(chalk.red(`  ✖ ${result.error}\n`));
    return;
  }

  console.log(chalk.green(`  ✔ Version created: ${result.versionName}`));
  if (result.versionId) {
    console.log(`    Version ID: ${result.versionId}`);
  }

  if (result.published) {
    console.log(chalk.green.bold("\n  🚀 Version published and LIVE!\n"));
  } else {
    console.log(chalk.yellow("\n  Version created but NOT published."));
    console.log("  To publish:");
    console.log(chalk.cyan(`    tagops publish --name "${result.versionName}" --confirm\n`));
  }
}
