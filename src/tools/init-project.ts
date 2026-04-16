/**
 * Project Initialization — one-command setup for TagOps
 *
 * Creates all necessary project files:
 *   1. .gtmrc.json — with provided or placeholder IDs
 *   2. .tagops-policies.json — with safe default policies enabled
 *   3. GitHub Actions workflows — PR checks, deploy, drift detection
 *
 * Usage:
 *   tagops init --ci --account-id 123 --container-id 456 --workspace-id 1
 */

import chalk from "chalk";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { hasConfig, loadConfig, writeConfig, type GtmConfig } from "../lib/config.js";
import { initCi, printInitCiReport, type InitCiOptions, type InitCiReport } from "./init-ci.js";
import { getPolicyPack, isPolicyPackName, listPolicyPacks } from "../lib/policy-packs.js";

export interface InitProjectOptions extends InitCiOptions {
  accountId?: string;
  containerId?: string;
  workspaceId?: string;
  ci?: boolean;
  policies?: string;
}

export interface InitProjectReport extends InitCiReport {
  configCreated: boolean;
  configUpdated: boolean;
  policiesCreated: boolean;
  policyPack?: string;
}

/**
 * Initialize a full TagOps project with config, policies, and CI workflows.
 */
export function initProject(options: InitProjectOptions = {}): InitProjectReport {
  const { accountId, containerId, workspaceId, ci, ...ciOptions } = options;
  const shouldWriteExplicitConfig = Boolean(accountId && containerId && workspaceId);

  // Step 1: Create .gtmrc.json if it doesn't exist
  let configCreated = false;
  let configUpdated = false;
  if (shouldWriteExplicitConfig) {
    const explicitAccountId = accountId as string;
    const explicitContainerId = containerId as string;
    const explicitWorkspaceId = workspaceId as string;
    const configExists = hasConfig();
    const existingConfig = configExists ? loadConfig("default") : undefined;
    const config: GtmConfig = {
      ...existingConfig,
      accountId: explicitAccountId,
      containerId: explicitContainerId,
      workspaceId: explicitWorkspaceId,
    };
    writeConfig(config);
    configCreated = !configExists;
    configUpdated = configExists;
  } else if (!hasConfig()) {
    const config: GtmConfig = {
      accountId: "YOUR-ACCOUNT-ID",
      containerId: "YOUR-CONTAINER-ID",
      workspaceId: "YOUR-WORKSPACE-ID",
    };
    writeConfig(config);
    configCreated = true;
  }

  // Step 2: Create .tagops-policies.json
  let policiesCreated = false;
  let policyPackUsed: string | undefined;
  const policiesPath = resolve(".tagops-policies.json");

  // Determine policy content
  if (options.policies) {
    // Explicit --policies flag: use preset pack (overwrite existing)
    if (!isPolicyPackName(options.policies)) {
      const available = listPolicyPacks()
        .map((p) => `${p.name} — ${p.description}`)
        .join("\n    ");
      throw new Error(
        `Unknown policy pack "${options.policies}". Available packs:\n    ${available}`,
      );
    }
    const pack = getPolicyPack(options.policies);
    writeFileSync(policiesPath, JSON.stringify(pack.config, null, 2) + "\n");
    policiesCreated = true;
    policyPackUsed = pack.title;
  } else if (!existsSync(policiesPath)) {
    // No flag + no existing file: write minimal defaults
    const policiesConfig = {
      enabledPolicies: [
        "consent-v2-advertising",
        "spa-firing-safety",
        "naming-convention",
        "no-orphaned-triggers",
      ],
      naming: {
        tagPrefixes: ["GA4", "Meta", "TikTok", "Google Ads"],
        triggerPattern: "^(CE|PV|Click|History)\\s[-–]\\s",
        tagPattern: "^[A-Za-z0-9][A-Za-z0-9 ]*\\s[-–]\\s",
      },
    };
    writeFileSync(policiesPath, JSON.stringify(policiesConfig, null, 2) + "\n");
    policiesCreated = true;
  }

  // Step 3: Create GitHub Actions workflows
  let ciReport: InitCiReport = {
    branch: ciOptions.branch?.trim() || "main",
    filesCreated: [],
    filesSkipped: [],
  };

  if (ci !== false) {
    ciReport = initCi(ciOptions);
  }

  return {
    ...ciReport,
    configCreated,
    configUpdated,
    policiesCreated,
    policyPack: policyPackUsed,
  };
}

export function printInitProjectReport(report: InitProjectReport): void {
  console.log(chalk.bold("\n  TagOps Project Initialization\n"));

  if (report.configCreated) {
    console.log(`  ${chalk.green("✔")} Created .gtmrc.json`);
    console.log(
      `    ${chalk.dim("Update YOUR-ACCOUNT-ID, YOUR-CONTAINER-ID, YOUR-WORKSPACE-ID with real values")}`,
    );
  } else if (report.configUpdated) {
    console.log(`  ${chalk.green("✔")} Updated .gtmrc.json`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} .gtmrc.json already exists — skipped`);
  }

  if (report.policiesCreated) {
    const detail = report.policyPack
      ? `policy pack: ${report.policyPack}`
      : "consent-v2, SPA safety, naming, orphaned triggers";
    console.log(`  ${chalk.green("✔")} Created .tagops-policies.json (${detail})`);
  } else {
    console.log(`  ${chalk.yellow("⚠")} .tagops-policies.json already exists — skipped`);
  }

  // Delegate CI report output
  printInitCiReport(report);
}
