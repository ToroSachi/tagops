/**
 * Doctor — Diagnostic command for tagops
 *
 * Runs a series of checks to identify common configuration issues:
 *   - Node.js version
 *   - .gtmrc.json config file validity
 *   - Google Cloud credentials
 *   - API connectivity
 *   - Container health (resource counts)
 *   - Consent Mode v2 compliance score
 *
 * Usage:
 *   tagops doctor
 */

import chalk from "chalk";

export interface DoctorCheck {
  name: string;
  status: "pass" | "warn" | "fail";
  detail: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  passed: number;
  warnings: number;
  failures: number;
}

export async function runDoctor(): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];

  // 1. Node.js version
  const nodeVersion = process.version;
  const major = parseInt(nodeVersion.slice(1).split(".")[0], 10);
  checks.push({
    name: "Node.js Version",
    status: major >= 18 ? "pass" : "fail",
    detail:
      major >= 18 ? `${nodeVersion} (≥18 required)` : `${nodeVersion} — upgrade to Node.js 18+`,
  });

  // 2. .gtmrc.json config
  try {
    const { loadConfig } = await import("../lib/config.js");
    const config = loadConfig();
    if (config.accountId && config.containerId) {
      checks.push({
        name: "Configuration (.gtmrc.json)",
        status: "pass",
        detail: `Account: ${config.accountId}, Container: ${config.containerId}, Workspace: ${config.workspaceId}`,
      });
    } else {
      checks.push({
        name: "Configuration (.gtmrc.json)",
        status: "warn",
        detail: "Config exists but missing accountId or containerId. Run: tagops init",
      });
    }
  } catch {
    checks.push({
      name: "Configuration (.gtmrc.json)",
      status: "fail",
      detail: "No .gtmrc.json found. Run: tagops init --account-id <ID> --container-id <ID>",
    });
  }

  // 3. Google credentials
  try {
    const { checkAuthStatus } = await import("../lib/auth.js");
    const authStatus = await checkAuthStatus();
    if (authStatus.authenticated) {
      checks.push({
        name: "Google Credentials",
        status: "pass",
        detail: `Authenticated via ${authStatus.method}`,
      });
    } else {
      checks.push({
        name: "Google Credentials",
        status: "fail",
        detail: "Not authenticated. Run: tagops auth login",
      });
    }
  } catch {
    checks.push({
      name: "Google Credentials",
      status: "fail",
      detail: "Could not check credentials. Run: tagops auth login",
    });
  }

  // 4. API connectivity + resource counts
  try {
    const { listTags, listTriggers, listVariables } = await import("../lib/gtm-cli.js");
    const [tags, triggers, variables] = await Promise.all([
      listTags(),
      listTriggers(),
      listVariables(),
    ]);

    if (tags.length > 0 || triggers.length > 0) {
      checks.push({
        name: "GTM API Connectivity",
        status: "pass",
        detail: `Connected — ${tags.length} tags, ${triggers.length} triggers, ${variables.length} variables`,
      });
    } else {
      checks.push({
        name: "GTM API Connectivity",
        status: "warn",
        detail: "Connected but workspace appears empty (0 tags, 0 triggers)",
      });
    }

    // 5. Resource health
    const pausedCount = tags.filter((t) => t.paused).length;
    const noTriggerCount = tags.filter(
      (t) => !t.paused && (!t.firingTriggerId || t.firingTriggerId.length === 0),
    ).length;

    if (noTriggerCount > 0 || pausedCount > 5) {
      const issues: string[] = [];
      if (noTriggerCount > 0) issues.push(`${noTriggerCount} tags without triggers`);
      if (pausedCount > 5) issues.push(`${pausedCount} paused tags`);
      checks.push({
        name: "Resource Health",
        status: "warn",
        detail: issues.join(", ") + ". Run: tagops audit",
      });
    } else {
      checks.push({
        name: "Resource Health",
        status: "pass",
        detail: `All tags have triggers, ${pausedCount} paused`,
      });
    }

    // 6. Consent compliance
    try {
      const { auditConsentV2 } = await import("./consent-audit.js");
      const consentReport = await auditConsentV2();
      checks.push({
        name: "Consent Mode v2",
        status:
          consentReport.complianceScore >= 100
            ? "pass"
            : consentReport.complianceScore >= 60
              ? "warn"
              : "fail",
        detail: `${consentReport.complianceScore}% compliant (${consentReport.auditedTags} tags audited). Run: tagops consent-audit`,
      });
    } catch {
      checks.push({
        name: "Consent Mode v2",
        status: "warn",
        detail: "Could not run consent audit",
      });
    }
  } catch {
    checks.push({
      name: "GTM API Connectivity",
      status: "fail",
      detail: "Cannot connect to GTM API. Check credentials and .gtmrc.json",
    });
  }

  const passed = checks.filter((c) => c.status === "pass").length;
  const warnings = checks.filter((c) => c.status === "warn").length;
  const failures = checks.filter((c) => c.status === "fail").length;

  return { checks, passed, warnings, failures };
}

/**
 * Print a formatted doctor report.
 */
export function printDoctorReport(report: DoctorReport): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(chalk.bold("  tagops doctor"));
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  for (const check of report.checks) {
    const icon =
      check.status === "pass"
        ? chalk.green("✔")
        : check.status === "warn"
          ? chalk.yellow("⚠")
          : chalk.red("✖");

    console.log(`  ${icon} ${chalk.bold(check.name)}`);
    console.log(`    ${chalk.dim(check.detail)}`);
  }

  console.log(chalk.bold("\n──────────────────────────────────────────────────"));
  const summary = `  ${report.passed} passed, ${report.warnings} warnings, ${report.failures} failures`;
  if (report.failures > 0) {
    console.log(chalk.red(summary));
  } else if (report.warnings > 0) {
    console.log(chalk.yellow(summary));
  } else {
    console.log(chalk.green(summary + " — all good! 🎉"));
  }
  console.log();
}
