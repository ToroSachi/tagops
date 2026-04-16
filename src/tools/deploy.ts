/**
 * Deploy — batch install multiple templates from a manifest file.
 *
 * Reads a JSON manifest (deploy.json) that lists which templates to install
 * with their respective pixel IDs, then installs them all in sequence.
 *
 * Manifest format:
 *   {
 *     "name": "My Store GTM Setup",
 *     "templates": [
 *       { "id": "shopify-custom-pixel", "pixelId": "GTM-XXXXXXX" },
 *       { "id": "meta-pixel", "pixelId": "1234567890" },
 *       { "id": "tiktok-pixel", "pixelId": "CXXXXXXXX" }
 *     ]
 *   }
 *
 * Usage:
 *   npx tsx src/cli.ts deploy manifest.json [--dry-run]
 *   npx tsx src/cli.ts deploy --init  (creates a starter manifest)
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { installTemplate, listTemplates, type InstallResult } from "../templates/registry.js";
import { requireWriteAccess } from "../lib/permission-guard.js";

export interface DeployManifest {
  name: string;
  description?: string;
  templates: Array<{
    id: string;
    pixelId: string;
    measurementId?: string;
    disabled?: boolean;
  }>;
}

export interface DeployResult {
  manifestName: string;
  manifestFile: string;
  dryRun: boolean;
  results: InstallResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
    totalTags: number;
  };
}

export function loadManifest(manifestPath: string): DeployManifest {
  const filePath = resolve(manifestPath);
  if (!existsSync(filePath)) {
    throw new Error(
      `Manifest not found: ${filePath}\nRun 'tagops deploy --init' to create a starter manifest.`,
    );
  }

  const raw = readFileSync(filePath, "utf-8");
  const manifest = JSON.parse(raw) as DeployManifest;

  if (!manifest.templates || !Array.isArray(manifest.templates)) {
    throw new Error("Invalid manifest: 'templates' array is required.");
  }

  // Validate template IDs exist
  const validIds = new Set(listTemplates().map((t) => t.id));
  for (const entry of manifest.templates) {
    if (!validIds.has(entry.id)) {
      throw new Error(
        `Unknown template '${entry.id}' in manifest. Run 'tagops templates list' to see available templates.`,
      );
    }
    if (!entry.pixelId) {
      throw new Error(`Template '${entry.id}' is missing required 'pixelId' in manifest.`);
    }
  }

  return manifest;
}

export async function deployManifest(
  manifestPath: string,
  options: { dryRun?: boolean } = {},
): Promise<DeployResult> {
  const manifest = loadManifest(manifestPath);
  const dryRun = options.dryRun ?? false;
  if (!dryRun) {
    await requireWriteAccess();
  }

  const results: InstallResult[] = [];
  let skipped = 0;

  for (const entry of manifest.templates) {
    if (entry.disabled) {
      skipped++;
      continue;
    }

    const result = await installTemplate(entry.id, {
      dryRun,
      pixelId: entry.pixelId,
      measurementId: entry.measurementId,
    });
    results.push(result);
  }

  const succeeded = results.filter((r) => r.summary.failed === 0).length;
  const failed = results.filter((r) => r.summary.failed > 0).length;
  const totalTags = results.reduce((sum, r) => sum + r.summary.tags, 0);

  return {
    manifestName: manifest.name,
    manifestFile: resolve(manifestPath),
    dryRun,
    results,
    summary: {
      total: manifest.templates.length,
      succeeded,
      failed,
      skipped,
      totalTags,
    },
  };
}

export function printDeployResult(result: DeployResult): void {
  const prefix = result.dryRun ? chalk.cyan("[DRY RUN] ") : "";
  console.log(chalk.bold(`\n  ${prefix}Deploy: ${result.manifestName}\n`));

  for (const install of result.results) {
    const icon = install.summary.failed === 0 ? chalk.green("✔") : chalk.red("✖");
    console.log(`  ${icon} ${install.templateName} — ${install.summary.tags} tag(s)`);
    for (const action of install.actions) {
      const subIcon =
        action.action === "created"
          ? chalk.green("·")
          : action.action === "dry_run"
            ? chalk.cyan("·")
            : chalk.red("·");
      console.log(`    ${subIcon} ${action.name}`);
    }
  }

  const s = result.summary;
  console.log(chalk.bold("\n  Summary"));
  console.log(
    `    Templates: ${chalk.green(`${s.succeeded} ok`)}${s.failed > 0 ? chalk.red(`, ${s.failed} failed`) : ""}${s.skipped > 0 ? chalk.gray(`, ${s.skipped} skipped`) : ""}`,
  );
  console.log(`    Total tags: ${s.totalTags}`);
  console.log();
}

export function createStarterManifest(outputPath?: string): string {
  const filePath = resolve(outputPath ?? "deploy.json");
  const templates = listTemplates();

  const manifest: DeployManifest = {
    name: "My Store GTM Setup",
    description: "Edit the pixelId values and remove any templates you don't need.",
    templates: templates.map((t) => ({
      id: t.id,
      pixelId: t.requiredInputs[0]?.example ?? "YOUR_ID_HERE",
      disabled: true, // Start disabled — user enables what they need
    })),
  };

  writeFileSync(filePath, JSON.stringify(manifest, null, 2) + "\n");
  return filePath;
}
