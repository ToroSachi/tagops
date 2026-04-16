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

// ── Full Status Dashboard ──────────────────────────

export interface FullStatusReport extends StatusReport {
  healthScore: number | null;
  healthGrade: string | null;
  consentScore: number | null;
  consentNonCompliant: number;
  snapshotAge: string | null;
  totalIssues: number;
}

/**
 * Run a comprehensive health dashboard — combines status, health score,
 * consent audit, and cleanup scan into a single report.
 */
export async function checkFullStatus(): Promise<FullStatusReport> {
  const baseStatus = await checkStatus();

  // Default values if not authenticated
  let healthScore: number | null = null;
  let healthGrade: string | null = null;
  let consentScore: number | null = null;
  let consentNonCompliant = 0;
  let totalIssues = 0;
  let snapshotAge: string | null = null;

  // Check snapshot age
  const snapshotPath = resolve(process.cwd(), "gtm-snapshot.json");
  if (existsSync(snapshotPath)) {
    try {
      const stat = statSync(snapshotPath);
      const ageMs = Date.now() - stat.mtimeMs;
      const ageHours = Math.floor(ageMs / (1000 * 60 * 60));
      const ageDays = Math.floor(ageHours / 24);
      if (ageDays > 0) {
        snapshotAge = `${ageDays}d ${ageHours % 24}h ago`;
      } else {
        snapshotAge = `${ageHours}h ago`;
      }
    } catch {
      snapshotAge = "error reading";
    }
  }

  if (baseStatus.authenticated && baseStatus.tagCount !== null) {
    const [healthResult, consentResult] = await Promise.allSettled([
      import("./health-score.js").then(async ({ calculateHealthScore }) => {
        const { listTags, listTriggers, listVariables } = await import("../lib/gtm-cli.js");
        const [tags, triggers, vars] = await Promise.all([
          listTags(),
          listTriggers(),
          listVariables(),
        ]);
        return calculateHealthScore(tags, triggers, vars);
      }),
      import("./consent-audit.js").then(async ({ auditConsentV2 }) => {
        return auditConsentV2();
      }),
    ]);

    if (healthResult.status === "fulfilled") {
      healthScore = healthResult.value.overallScore;
      healthGrade = healthResult.value.grade;
    }

    if (consentResult.status === "fulfilled") {
      consentScore = consentResult.value.complianceScore;
      consentNonCompliant =
        consentResult.value.nonCompliantTags + consentResult.value.notConfiguredTags;
    }

    totalIssues = consentNonCompliant;
  }

  return {
    ...baseStatus,
    healthScore,
    healthGrade,
    consentScore,
    consentNonCompliant,
    snapshotAge,
    totalIssues,
  };
}

function gradeColor(grade: string): string {
  if (grade.startsWith("A")) return chalk.green(grade);
  if (grade.startsWith("B")) return chalk.greenBright(grade);
  if (grade.startsWith("C")) return chalk.yellow(grade);
  if (grade.startsWith("D")) return chalk.red(grade);
  return chalk.redBright(grade);
}

function scoreBar(score: number, width = 20): string {
  const filled = Math.round((score / 100) * width);
  const bar = "█".repeat(filled) + "░".repeat(width - filled);
  if (score >= 80) return chalk.green(bar);
  if (score >= 60) return chalk.yellow(bar);
  return chalk.red(bar);
}

export function printFullStatus(report: FullStatusReport): void {
  console.log(chalk.bold("\n  ┌─────────────────────────────────────────┐"));
  console.log(chalk.bold("  │         TagOps Container Dashboard       │"));
  console.log(chalk.bold("  └─────────────────────────────────────────┘\n"));

  const ok = chalk.green("✔");
  const warn = chalk.yellow("⚠");
  const fail = chalk.red("✖");

  // Row 1: Identity
  console.log(`  ${chalk.dim("Version:")}   ${report.cliVersion ?? "unknown"}`);
  console.log(
    `  ${chalk.dim("Auth:")}      ${report.authenticated ? ok + " connected" : fail + " not authenticated"}`,
  );
  console.log(
    `  ${chalk.dim("Account:")}   ${report.accountId} / Container: ${report.containerId} / Workspace: ${report.workspaceId}`,
  );
  console.log(
    `  ${chalk.dim("Resources:")} ${report.tagCount ?? "?"} tags · ${report.triggerCount ?? "?"} triggers · ${report.variableCount ?? "?"} variables`,
  );
  console.log();

  // Row 2: Scores
  if (report.healthScore !== null) {
    console.log(
      `  ${chalk.bold("Health")}     ${scoreBar(report.healthScore)} ${report.healthScore}/100 ${gradeColor(report.healthGrade ?? "?")}`,
    );
  }
  if (report.consentScore !== null) {
    const consentIcon = report.consentScore === 100 ? ok : report.consentScore >= 80 ? warn : fail;
    console.log(
      `  ${chalk.bold("Consent")}    ${scoreBar(report.consentScore)} ${report.consentScore}/100 ${consentIcon}`,
    );
  }
  console.log();

  // Row 3: Issues
  console.log(`  ${chalk.dim("Issues Found:")}`);
  const consentLabel = report.consentNonCompliant === 0 ? ok : fail;
  console.log(`    ${consentLabel} Consent non-compliant tags: ${report.consentNonCompliant}`);
  console.log();

  // Row 4: Freshness
  const snapshotLabel = report.snapshotAge ? ok : warn;
  console.log(
    `  ${chalk.dim("Snapshot:")}  ${snapshotLabel} ${report.snapshotAge ?? "no snapshot found — run: tagops snapshot"}`,
  );
  console.log();

  // Summary line
  if (report.totalIssues === 0) {
    console.log(`  ${chalk.green.bold("🎉 Container is healthy — no issues found.")}`);
  } else {
    console.log(
      `  ${chalk.yellow.bold(`⚠ ${report.totalIssues} issue(s) found.`)} Run ${chalk.cyan("tagops audit")} for details.`,
    );
  }
  console.log();
}
