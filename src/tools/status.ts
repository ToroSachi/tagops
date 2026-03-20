/**
 * Status — quick health check for GTM CLI connectivity.
 *
 * Verifies: CLI installed, authenticated, workspace accessible.
 * Prints tag/trigger/variable counts and last backup info.
 *
 * Usage:
 *   npx tsx src/cli.ts status
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import chalk from "chalk";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import { checkAuthStatus } from "../lib/auth.js";
import { loadConfig, getConfigPath } from "../lib/config.js";

export interface StatusReport {
  cliInstalled: boolean;
  cliVersion: string | null;
  authenticated: boolean;
  configPath: string | null;
  accountId: string;
  containerId: string;
  workspaceId: string;
  tagCount: number | null;
  triggerCount: number | null;
  variableCount: number | null;
  lastBackup: string | null;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

function getCliVersion(): string | null {
  try {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, "../../package.json"), "utf-8")) as {
      version?: unknown;
    };
    return typeof pkg.version === "string" ? pkg.version : null;
  } catch {
    return null;
  }
}

export async function checkStatus(): Promise<StatusReport> {
  const config = loadConfig();
  const configPath = getConfigPath();

  // Check CLI installed — we no longer have a python CLI wrapper, so this is just true if the node tool is running.
  const cliInstalled = true;
  const cliVersion = getCliVersion();

  // Check auth
  const authCheck = await checkAuthStatus();
  const authenticated = authCheck.authenticated;

  // Count resources (only if authenticated)
  let tagCount: number | null = null;
  let triggerCount: number | null = null;
  let variableCount: number | null = null;

  if (authenticated) {
    const tags = await listTags();
    const triggers = await listTriggers();
    const variables = await listVariables();
    tagCount = tags.length;
    triggerCount = triggers.length;
    variableCount = variables.length;
  }

  // Find last backup
  const backupDir = resolve(process.cwd(), "backups");
  let lastBackup: string | null = null;
  if (existsSync(backupDir)) {
    const entries = readdirSync(backupDir)
      .filter((e) => {
        const fullPath = join(backupDir, e);
        return statSync(fullPath).isDirectory();
      })
      .sort()
      .reverse();
    if (entries.length > 0) {
      lastBackup = entries[0]
        .replace("_", " @ ")
        .replace(/(\d{4})(\d{2})(\d{2}) @ (\d{2})(\d{2})(\d{2})/, "$1-$2-$3 @ $4:$5:$6");
    }
  }

  return {
    cliInstalled,
    cliVersion,
    authenticated,
    configPath,
    accountId: config.accountId,
    containerId: config.containerId,
    workspaceId: config.workspaceId,
    tagCount,
    triggerCount,
    variableCount,
    lastBackup,
  };
}

export function printStatus(report: StatusReport): void {
  console.log(chalk.bold("\n  GTM CLI Automation — Status\n"));

  const ok = chalk.green("✔");
  const fail = chalk.red("✖");

  console.log(
    `  GTM CLI:      ${report.cliInstalled ? ok : fail} ${
      report.cliInstalled
        ? report.cliVersion
          ? `installed (${report.cliVersion})`
          : "installed"
        : "not installed"
    }`,
  );
  console.log(
    `  Auth:         ${report.authenticated ? ok : fail} ${
      report.authenticated ? "authenticated" : "not authenticated — run: tagops auth login"
    }`,
  );
  console.log(
    `  Config:       ${report.configPath ? ok + " " + report.configPath : chalk.gray("none (using defaults)")}`,
  );
  console.log(`  Account:      ${report.accountId}`);
  console.log(`  Container:    ${report.containerId}`);
  console.log(`  Workspace:    ${report.workspaceId}`);

  if (report.tagCount !== null) {
    console.log(`  Tags:         ${report.tagCount}`);
    console.log(`  Triggers:     ${report.triggerCount}`);
    console.log(`  Variables:    ${report.variableCount}`);
  }

  console.log(`  Last backup:  ${report.lastBackup ?? chalk.gray("none")}`);
  console.log();
}
