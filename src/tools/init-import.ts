/**
 * Auto-import an existing GTM container into a local IaC workspace.
 *
 * Does the full onboarding in one command:
 *   1. Writes .gtmrc.json
 *   2. Snapshots every tag/trigger/variable/folder/etc. to gtm-snapshot.json
 *   3. Runs a Consent Mode v2 audit and writes a shareable Markdown report
 *   4. Emits a human-readable narrative summary
 *
 * The goal is the "it just imported my 400-tag container AND told me 11 tags
 * are consent-broken" moment — the screenshotable demo.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import chalk from "chalk";
import { takeSnapshot } from "./snapshot.js";
import {
  auditConsentV2,
  estimateEuDataLoss,
  generateConsentMarkdownReport,
  printSavingsEstimate,
  type SavingsEstimate,
} from "./consent-audit.js";
import { writeConfig } from "../lib/config.js";

export interface InitImportInput {
  accountId: string;
  containerId: string;
  workspaceId: string;
  savings?: {
    monthlyConversions: number;
    avgValue: number;
    eeaShare?: number;
    currency?: string;
  };
}

export interface InitImportResult {
  configPath: string;
  snapshotPath: string;
  reportPath: string;
  tagCount: number;
  triggerCount: number;
  variableCount: number;
  folderCount: number;
  consentScore: number;
  nonCompliantTags: number;
  notConfiguredTags: number;
  totalAuditedTags: number;
  savingsEstimate?: SavingsEstimate;
}

export async function runInitImport(input: InitImportInput): Promise<InitImportResult> {
  const config = {
    accountId: input.accountId,
    containerId: input.containerId,
    workspaceId: input.workspaceId,
  };

  const configPath = writeConfig(config);

  const snapshot = await takeSnapshot();

  const audit = await auditConsentV2();

  const reportDate = new Date().toISOString().slice(0, 10);
  const reportPath = resolve(process.cwd(), `consent-report-${reportDate}.md`);
  const markdown = generateConsentMarkdownReport(audit, {
    accountId: input.accountId,
    containerId: input.containerId,
  });
  writeFileSync(reportPath, markdown);

  const savingsEstimate = input.savings
    ? estimateEuDataLoss(audit, {
        monthlyConversions: input.savings.monthlyConversions,
        avgValue: input.savings.avgValue,
        eeaShare: input.savings.eeaShare ?? 0.3,
        currency: input.savings.currency,
      })
    : undefined;

  return {
    configPath,
    snapshotPath: snapshot.path,
    reportPath,
    tagCount: snapshot.tagCount,
    triggerCount: snapshot.triggerCount,
    variableCount: snapshot.variableCount,
    folderCount: snapshot.folderCount,
    consentScore: audit.complianceScore,
    nonCompliantTags: audit.nonCompliantTags,
    notConfiguredTags: audit.notConfiguredTags,
    totalAuditedTags: audit.totalTags,
    savingsEstimate,
  };
}

export function printInitImportResult(result: InitImportResult): void {
  const issueCount = result.nonCompliantTags + result.notConfiguredTags;
  const scoreBadge =
    result.consentScore >= 90
      ? chalk.green(`${result.consentScore}%`)
      : result.consentScore >= 70
        ? chalk.yellow(`${result.consentScore}%`)
        : chalk.red(`${result.consentScore}%`);

  console.log();
  console.log(chalk.bold("  ✔ Container imported"));
  console.log();
  console.log(`  ${chalk.dim("Config:")}      ${result.configPath}`);
  console.log(`  ${chalk.dim("Snapshot:")}    ${result.snapshotPath}`);
  console.log(`  ${chalk.dim("Report:")}      ${result.reportPath}`);
  console.log();
  console.log(chalk.bold("  What's inside"));
  console.log(
    `    ${result.tagCount} tags · ${result.triggerCount} triggers · ${result.variableCount} variables · ${result.folderCount} folders`,
  );
  console.log();
  console.log(chalk.bold("  Consent Mode v2 compliance"));
  console.log(`    ${scoreBadge} (${result.totalAuditedTags} tags audited)`);

  if (issueCount > 0) {
    console.log(
      `    ${chalk.red("✖")} ${result.nonCompliantTags} non-compliant · ${chalk.yellow("⚠")} ${result.notConfiguredTags} unconfigured`,
    );
  } else if (result.totalAuditedTags > 0) {
    console.log(`    ${chalk.green("✔")} All audited tags are Consent Mode v2 compliant.`);
  }

  if (result.savingsEstimate) {
    printSavingsEstimate(result.savingsEstimate);
  }

  console.log();
  console.log(chalk.bold("  Next"));
  if (issueCount > 0) {
    console.log(chalk.cyan("    tagops consent-audit --fix --dry-run   # preview the fix"));
  }
  if (!result.savingsEstimate && issueCount > 0) {
    console.log(
      chalk.cyan(
        "    tagops consent-audit --monthly-conversions N --avg-value V   # estimate $ exposure",
      ),
    );
  }
  console.log(chalk.cyan("    tagops diff                              # after editing"));
  console.log(chalk.cyan("    tagops templates list                    # install vendor pixels"));
  console.log(
    chalk.cyan("    tagops init --ci                         # add a GitHub Actions gate"),
  );
  console.log();
}
