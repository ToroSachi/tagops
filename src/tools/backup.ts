/**
 * Backup all GTM workspace resources to timestamped JSON files.
 *
 * Usage:
 *   npx tsx src/tools/backup.ts
 *   npx tsx src/cli.ts backup [--output-dir ./my-backups]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import chalk from "chalk";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface BackupResult {
  backupDir: string;
  resources: Array<{
    type: string;
    count: number;
    path: string;
  }>;
}

export async function backupWorkspace(outputDir?: string): Promise<BackupResult> {
  const baseDir = outputDir ?? resolve(import.meta.dirname ?? ".", "..", "..", "backups");
  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace(/(\d{8})(\d{6})/, "$1_$2");

  const backupDir = join(baseDir, timestamp);
  mkdirSync(backupDir, { recursive: true });

  const resourceConfigs: Array<{ name: string; fetcher: () => Promise<unknown[]> }> = [
    { name: "tags", fetcher: listTags },
    { name: "triggers", fetcher: listTriggers },
    { name: "variables", fetcher: listVariables },
  ];

  const results: BackupResult["resources"] = [];

  for (const { name, fetcher } of resourceConfigs) {
    const data = await fetcher();
    if (data.length === 0) {
      console.log(`  ${chalk.red("✖")} Failed to export ${name}`);
      continue;
    }

    const filepath = join(backupDir, `${name}.json`);
    writeFileSync(filepath, JSON.stringify(data, null, 2));
    results.push({ type: name, count: data.length, path: filepath });
    console.log(`  ${chalk.green("→")} ${filepath} (${data.length} ${name})`);
  }

  return { backupDir, resources: results };
}

export function printBackupResult(result: BackupResult): void {
  console.log(chalk.bold("\n=== GTM Workspace Backup ===\n"));
  for (const r of result.resources) {
    console.log(`  ${chalk.green("✔")} ${r.type}: ${r.count} items → ${r.path}`);
  }
  console.log(chalk.bold(`\n✅ Backup complete: ${result.backupDir}`));
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const outputDir = process.argv.includes("--output-dir")
      ? process.argv[process.argv.indexOf("--output-dir") + 1]
      : undefined;
    console.log(chalk.bold("=== GTM Workspace Backup ===\n"));
    backupWorkspace(outputDir)
      .then((result) => {
        console.log(chalk.bold(`\n✅ Backup complete: ${result.backupDir}`));
      })
      .catch((err) => {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      });
  } catch (err) {
    console.error(chalk.red(`\n✖ ${(err as Error).message}`));
    process.exit(1);
  }
}
