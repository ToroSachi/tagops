import chalk from "chalk";
import {
  type PromotionEnvironment,
  type PromotionValidationResult,
  validatePromotionFlow,
  withDefaultProfileName,
} from "../lib/config.js";
import { compareContainers, type CompareResult, type ResourceDiff } from "./compare.js";
import { runPublish, type PublishResult } from "./publish.js";
import { syncContainers, type SyncResult } from "./sync.js";

type PromotionRiskLevel = "low" | "medium" | "high";

interface PromotionPlanSection {
  create: ResourceDiff[];
  update: ResourceDiff[];
  targetOnly: ResourceDiff[];
  identical: number;
}

interface PromotionRiskAssessment {
  level: PromotionRiskLevel;
  reasons: string[];
}

interface PromotionTotals {
  create: number;
  update: number;
  apply: number;
  targetOnly: number;
  identical: number;
}

export interface PromotionPlan {
  sourceProfile: string;
  targetProfile: string;
  sourceEnvironment: PromotionEnvironment;
  targetEnvironment: PromotionEnvironment;
  allowedFlow: PromotionEnvironment[];
  compare: CompareResult;
  tags: PromotionPlanSection;
  triggers: PromotionPlanSection;
  variables: PromotionPlanSection;
  totals: PromotionTotals;
  publishRequested: boolean;
  versionName?: string;
  versionDescription?: string;
  risk: PromotionRiskAssessment;
  warnings: string[];
}

export interface PromoteOptions {
  dryRun?: boolean;
  publish?: boolean;
  force?: boolean;
  versionName?: string;
  versionDescription?: string;
  silent?: boolean;
}

export interface PromotionResult {
  dryRun: boolean;
  applied: boolean;
  published: boolean;
  plan: PromotionPlan;
  syncResult?: SyncResult;
  publishResult?: PublishResult;
  errors: string[];
}

function buildSectionPlan(diffs: ResourceDiff[]): PromotionPlanSection {
  return {
    create: diffs.filter((diff) => diff.status === "only_in_source"),
    update: diffs.filter((diff) => diff.status === "different"),
    targetOnly: diffs.filter((diff) => diff.status === "only_in_target"),
    identical: diffs.filter((diff) => diff.status === "identical").length,
  };
}

function getSectionActionCount(section: PromotionPlanSection): number {
  return section.create.length + section.update.length;
}

function buildVersionName(
  sourceProfile: string,
  targetProfile: string,
  sourceEnvironment: PromotionEnvironment,
  targetEnvironment: PromotionEnvironment,
): string {
  const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  return `Promote ${sourceProfile} (${sourceEnvironment}) -> ${targetProfile} (${targetEnvironment}) ${timestamp}`;
}

function buildVersionDescription(plan: PromotionPlan): string {
  return [
    `Automated promotion from ${plan.sourceProfile} (${plan.sourceEnvironment}) to ${plan.targetProfile} (${plan.targetEnvironment}).`,
    `Applied actions: ${plan.totals.apply} (${plan.totals.create} create, ${plan.totals.update} update).`,
    plan.totals.targetOnly > 0
      ? `Target-only drift remaining for manual review: ${plan.totals.targetOnly}.`
      : "No target-only drift detected.",
  ].join(" ");
}

function upgradeRisk(current: PromotionRiskLevel, next: PromotionRiskLevel): PromotionRiskLevel {
  const weights: Record<PromotionRiskLevel, number> = { low: 0, medium: 1, high: 2 };
  return weights[next] > weights[current] ? next : current;
}

function assessRisk(
  validation: PromotionValidationResult,
  plan: Omit<PromotionPlan, "risk">,
): PromotionRiskAssessment {
  let level: PromotionRiskLevel = "low";
  const reasons: string[] = [];

  if (validation.targetEnvironment === "production") {
    level = "high";
    reasons.push("Target environment is production.");
  }

  if (plan.publishRequested) {
    level = upgradeRisk(level, "high");
    reasons.push(
      "Promotion will create a GTM version and publish it live in the target container.",
    );
  }

  if (plan.totals.targetOnly > 0) {
    level = upgradeRisk(level, validation.targetEnvironment === "production" ? "high" : "medium");
    reasons.push(
      `${plan.totals.targetOnly} resources exist only in ${plan.targetProfile}; promotion will not delete them automatically.`,
    );
  }

  if (plan.totals.apply >= 10) {
    level = upgradeRisk(level, "medium");
    reasons.push(`${plan.totals.apply} create/update actions will be applied in one promotion.`);
  }

  if (plan.tags.update.length > 0) {
    level = upgradeRisk(level, "medium");
    reasons.push(
      `${plan.tags.update.length} tag updates can change firing behavior or measurement payloads.`,
    );
  }

  if (reasons.length === 0) {
    reasons.push("Limited create/update scope with no target-only drift detected.");
  }

  return { level, reasons };
}

function buildWarnings(
  validation: PromotionValidationResult,
  totals: PromotionTotals,
  publishRequested: boolean,
): string[] {
  const warnings: string[] = [];

  if (validation.targetEnvironment === "production") {
    warnings.push("Production promotion: review the plan carefully before applying.");
  }

  if (totals.targetOnly > 0) {
    warnings.push(
      `${totals.targetOnly} target-only resources will remain after promotion and may indicate manual drift.`,
    );
  }

  if (publishRequested) {
    warnings.push(
      "Publishing will make the promoted workspace version live in the target container.",
    );
  }

  return warnings;
}

function buildPromotionPlan(
  sourceProfile: string,
  targetProfile: string,
  validation: PromotionValidationResult,
  compare: CompareResult,
  opts: PromoteOptions,
): PromotionPlan {
  const tags = buildSectionPlan(compare.tags);
  const triggers = buildSectionPlan(compare.triggers);
  const variables = buildSectionPlan(compare.variables);

  const totals: PromotionTotals = {
    create: tags.create.length + triggers.create.length + variables.create.length,
    update: tags.update.length + triggers.update.length + variables.update.length,
    apply:
      getSectionActionCount(tags) +
      getSectionActionCount(triggers) +
      getSectionActionCount(variables),
    targetOnly: tags.targetOnly.length + triggers.targetOnly.length + variables.targetOnly.length,
    identical: tags.identical + triggers.identical + variables.identical,
  };

  const partialPlan: Omit<PromotionPlan, "risk"> = {
    sourceProfile,
    targetProfile,
    sourceEnvironment: validation.sourceEnvironment,
    targetEnvironment: validation.targetEnvironment,
    allowedFlow: validation.allowedFlow,
    compare,
    tags,
    triggers,
    variables,
    totals,
    publishRequested: !!opts.publish,
    versionName: opts.publish
      ? (opts.versionName ??
        buildVersionName(
          sourceProfile,
          targetProfile,
          validation.sourceEnvironment,
          validation.targetEnvironment,
        ))
      : undefined,
    versionDescription: opts.publish ? opts.versionDescription : undefined,
    warnings: buildWarnings(validation, totals, !!opts.publish),
  };

  const versionDescription =
    partialPlan.publishRequested && !partialPlan.versionDescription
      ? buildVersionDescription(partialPlan as PromotionPlan)
      : partialPlan.versionDescription;

  const plan: Omit<PromotionPlan, "risk"> = {
    ...partialPlan,
    versionDescription,
  };

  return {
    ...plan,
    risk: assessRisk(validation, plan),
  };
}

function printSection(label: string, section: PromotionPlanSection, targetProfile: string): void {
  console.log(chalk.bold(`  ${label}`));

  if (
    section.create.length === 0 &&
    section.update.length === 0 &&
    section.targetOnly.length === 0
  ) {
    console.log(`    ${chalk.green("✔")} No changes required`);
    console.log();
    return;
  }

  for (const diff of section.create) {
    console.log(`    ${chalk.green("+")} Create in ${targetProfile}: ${diff.name}`);
  }

  for (const diff of section.update) {
    console.log(`    ${chalk.cyan("~")} Update in ${targetProfile}: ${diff.name}`);
    if (diff.differences && diff.differences.length > 0) {
      const shown = diff.differences.slice(0, 5);
      console.log(`      ${chalk.dim(shown.join(", "))}`);
      if (diff.differences.length > shown.length) {
        console.log(
          `      ${chalk.dim(`+${diff.differences.length - shown.length} more differences`)}`,
        );
      }
    }
  }

  for (const diff of section.targetOnly) {
    console.log(`    ${chalk.yellow("!")} Target-only drift (unchanged): ${diff.name}`);
  }

  if (section.identical > 0) {
    console.log(`    ${chalk.dim(`${section.identical} already aligned`)}`);
  }

  console.log();
}

export function printPromotionPlan(plan: PromotionPlan): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(
    chalk.bold(`  Environment Promotion: ${plan.sourceProfile} -> ${plan.targetProfile}`),
  );
  console.log(chalk.bold("══════════════════════════════════════════════════"));
  console.log(
    `  Flow: ${plan.sourceEnvironment} -> ${plan.targetEnvironment} ${chalk.dim(`(allowed: ${plan.allowedFlow.join(" -> ")})`)}`,
  );
  console.log(`  Summary: ${plan.compare.summary}`);
  console.log(
    `  Actions: ${plan.totals.create} create, ${plan.totals.update} update, ${plan.totals.targetOnly} target-only drift`,
  );
  console.log();

  printSection("Variables", plan.variables, plan.targetProfile);
  printSection("Triggers", plan.triggers, plan.targetProfile);
  printSection("Tags", plan.tags, plan.targetProfile);

  console.log(chalk.bold("  Risk Assessment"));
  const riskColor =
    plan.risk.level === "high"
      ? chalk.red.bold
      : plan.risk.level === "medium"
        ? chalk.yellow.bold
        : chalk.green.bold;
  console.log(`    Level: ${riskColor(plan.risk.level.toUpperCase())}`);
  for (const reason of plan.risk.reasons) {
    console.log(`    - ${reason}`);
  }
  console.log();

  if (plan.warnings.length > 0) {
    console.log(chalk.bold("  Warnings"));
    for (const warning of plan.warnings) {
      console.log(`    - ${warning}`);
    }
    console.log();
  }

  if (plan.publishRequested) {
    console.log(chalk.bold("  Publish"));
    console.log(`    Version Name: ${plan.versionName}`);
    console.log(`    Description: ${plan.versionDescription ?? "(none)"}`);
    console.log();
  }
}

export async function promote(
  sourceProfile: string,
  targetProfile: string,
  opts: PromoteOptions = {},
): Promise<PromotionResult> {
  const log = (...args: unknown[]) => {
    if (!opts.silent) {
      console.log(...args);
    }
  };

  const validation = validatePromotionFlow(sourceProfile, targetProfile);
  const compare = await compareContainers(sourceProfile, targetProfile);
  const plan = buildPromotionPlan(sourceProfile, targetProfile, validation, compare, opts);

  if (!opts.silent) {
    printPromotionPlan(plan);
  }

  if (opts.dryRun) {
    log(chalk.yellow("  [DRY RUN] No changes applied.\n"));
    return {
      dryRun: true,
      applied: false,
      published: false,
      plan,
      errors: [],
    };
  }

  if (plan.totals.apply === 0) {
    log(chalk.green(`  ✔ ${targetProfile} is already aligned with ${sourceProfile}.`));
    if (opts.publish) {
      log(
        chalk.yellow("  Skipping publish because there are no create/update actions to promote.\n"),
      );
    } else {
      log();
    }

    return {
      dryRun: false,
      applied: false,
      published: false,
      plan,
      errors: [],
    };
  }

  const syncResult = await withDefaultProfileName(targetProfile, () =>
    syncContainers({
      source: sourceProfile,
      target: targetProfile,
      dryRun: false,
      force: opts.force,
      silent: opts.silent,
    }),
  );

  const errors = [...syncResult.errors];
  let publishResult: PublishResult | undefined;

  if (errors.length === 0 && opts.publish) {
    publishResult = await withDefaultProfileName(targetProfile, () =>
      runPublish({
        name: plan.versionName!,
        description: plan.versionDescription,
        confirm: true,
        dryRun: false,
      }),
    );

    if (publishResult.error) {
      errors.push(publishResult.error);
    }
  }

  return {
    dryRun: false,
    applied: errors.length === 0,
    published: publishResult?.published ?? false,
    plan,
    syncResult,
    publishResult,
    errors,
  };
}
