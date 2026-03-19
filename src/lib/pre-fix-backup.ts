/**
 * Pre-Fix Backup — automatic snapshot before any fix tool modifies the container.
 *
 * Every fix tool (fix-firing, consent-audit --fix, fix-consent) calls
 * createPreFixBackup() before writing. This creates a JSON snapshot that
 * can be restored with `tagops restore`.
 */

import { mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { listTags, listTriggers, listVariables } from "./gtm-cli.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export interface PreFixBackupResult {
  backupPath: string;
  toolName: string;
  timestamp: string;
  tagCount: number;
  triggerCount: number;
  variableCount: number;
}

/**
 * Create a pre-fix snapshot before any fix tool writes changes.
 * Saves to backups/pre-fix/<timestamp>_<toolName>.json
 */
export async function createPreFixBackup(toolName: string): Promise<PreFixBackupResult> {
  const baseDir = resolve(__dirname, "..", "..", "backups", "pre-fix");
  mkdirSync(baseDir, { recursive: true });

  const timestamp = new Date()
    .toISOString()
    .replace(/[-:T]/g, "")
    .replace(/\.\d+Z$/, "")
    .replace(/(\d{8})(\d{6})/, "$1_$2");

  const filename = `${timestamp}_${toolName}.json`;
  const backupPath = join(baseDir, filename);

  const [tags, triggers, variables] = await Promise.all([
    listTags(),
    listTriggers(),
    listVariables(),
  ]);

  const snapshot = {
    schemaVersion: "1.0",
    meta: {
      toolName,
      timestamp: new Date().toISOString(),
      description: `Auto-backup before ${toolName} run`,
    },
    tags,
    triggers,
    variables,
  };

  writeFileSync(backupPath, JSON.stringify(snapshot, null, 2));
  console.log(chalk.gray(`  📸 Pre-fix backup saved: ${backupPath}`));

  return {
    backupPath,
    toolName,
    timestamp,
    tagCount: tags.length,
    triggerCount: triggers.length,
    variableCount: variables.length,
  };
}

/**
 * List all pre-fix backups, most recent first.
 */
export function listPreFixBackups(): Array<{ path: string; toolName: string; timestamp: string }> {
  const baseDir = resolve(__dirname, "..", "..", "backups", "pre-fix");
  try {
    const files = readdirSync(baseDir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .reverse();
    return files.map((f) => {
      const match = f.match(/^(\d{8}_\d{6})_(.+)\.json$/);
      return {
        path: join(baseDir, f),
        toolName: match?.[2] ?? "unknown",
        timestamp: match?.[1] ?? "unknown",
      };
    });
  } catch {
    return [];
  }
}
