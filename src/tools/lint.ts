/**
 * Advanced GTM Linter
 *
 * Runs configurable compliance checks against a GTM workspace or snapshot.
 *
 * Usage:
 *   npx tsx src/cli.ts lint
 *   npx tsx src/cli.ts lint --config gtm-lint.json
 *   npx tsx src/cli.ts lint --snapshot backup.json
 */

import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import type { GtmSnapshot } from "./snapshot.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export interface LintRules {
  "require-consent"?: boolean;
  "block-custom-html"?: boolean;
  "naming-conventions"?: {
    tags?: string; // Regex string e.g., "^[A-Z]"
    triggers?: string;
    variables?: string;
  };
}

export const DEFAULT_RULES: LintRules = {
  "require-consent": true,
  "block-custom-html": false,
  "naming-conventions": {
    variables: "^(DLV|JS|1P|CJS|RegEx|Lookup|UDF|URL|Event) - ",
  },
};

export interface LintViolation {
  rule: string;
  level: "error" | "warning";
  resourceType: "tag" | "trigger" | "variable";
  resourceId: string;
  resourceName: string;
  message: string;
}

export interface LintReport {
  source: string;
  rulesApplied: number;
  violations: LintViolation[];
  passed: boolean;
  summary: {
    errors: number;
    warnings: number;
  };
}

/**
 * Load rules from a config file.
 */
export function loadLintConfig(configPath?: string): LintRules {
  const targetPath = resolve(configPath ?? "gtm-lint.json");
  if (!existsSync(targetPath)) {
    return DEFAULT_RULES;
  }
  try {
    const raw = readFileSync(targetPath, "utf-8");
    return JSON.parse(raw) as LintRules;
  } catch (err) {
    throw new Error(`Failed to parse lint config at ${targetPath}: ${(err as Error).message}`);
  }
}

/**
 * Run the linter against a dataset.
 */
export function runLinter(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variables: GtmVariable[],
  rules: LintRules,
  sourceLabel: string,
): LintReport {
  const violations: LintViolation[] = [];

  // --- Rule: require-consent ---
  if (rules["require-consent"]) {
    for (const tag of tags) {
      if (tag.paused) continue; // Skip paused tags
      const hasConsent =
        tag.consentSettings?.consentStatus === "needed" ||
        tag.consentSettings?.consentStatus === "notNeeded";

      if (!hasConsent) {
        violations.push({
          rule: "require-consent",
          level: "error",
          resourceType: "tag",
          resourceId: tag.tagId,
          resourceName: tag.name,
          message: "Tag is missing explicit consent settings (Advanced Consent Mode).",
        });
      }
    }
  }

  // --- Rule: block-custom-html ---
  if (rules["block-custom-html"]) {
    for (const tag of tags) {
      if (tag.paused) continue;
      if (tag.type === "html") {
        violations.push({
          rule: "block-custom-html",
          level: "error",
          resourceType: "tag",
          resourceId: tag.tagId,
          resourceName: tag.name,
          message: "Custom HTML tags are forbidden by this container's lint rules.",
        });
      }
    }
  }

  // --- Rule: naming-conventions ---
  const namingConfig = rules["naming-conventions"];
  if (namingConfig) {
    // Check Tags
    if (namingConfig.tags) {
      const regex = new RegExp(namingConfig.tags);
      for (const tag of tags) {
        if (!regex.test(tag.name)) {
          violations.push({
            rule: "naming-conventions",
            level: "warning",
            resourceType: "tag",
            resourceId: tag.tagId,
            resourceName: tag.name,
            message: `Tag name does not match required pattern: ${namingConfig.tags}`,
          });
        }
      }
    }

    // Check Triggers
    if (namingConfig.triggers) {
      const regex = new RegExp(namingConfig.triggers);
      for (const trig of triggers) {
        if (!regex.test(trig.name)) {
          violations.push({
            rule: "naming-conventions",
            level: "warning",
            resourceType: "trigger",
            resourceId: trig.triggerId,
            resourceName: trig.name,
            message: `Trigger name does not match required pattern: ${namingConfig.triggers}`,
          });
        }
      }
    }

    // Check Variables
    if (namingConfig.variables) {
      const regex = new RegExp(namingConfig.variables);
      // Skip built-in variables (usually starting with _ or simple names)
      const builtInRegex = /^(Page|Event|Error|Click|Form|History|Video|Scroll)/;

      for (const v of variables) {
        if (builtInRegex.test(v.name)) continue;

        if (!regex.test(v.name)) {
          violations.push({
            rule: "naming-conventions",
            level: "warning",
            resourceType: "variable",
            resourceId: v.variableId,
            resourceName: v.name,
            message: `Variable name does not match required pattern: ${namingConfig.variables}`,
          });
        }
      }
    }
  }

  const errors = violations.filter((v) => v.level === "error").length;
  const warnings = violations.filter((v) => v.level === "warning").length;

  return {
    source: sourceLabel,
    rulesApplied: Object.keys(rules).length,
    violations,
    passed: errors === 0, // Warnings don't fail the build
    summary: { errors, warnings },
  };
}

/**
 * Main entrypoint for CLI.
 */
export async function lintWorkspace(opts: {
  config?: string;
  snapshot?: string;
}): Promise<LintReport> {
  let tags: GtmTag[];
  let triggers: GtmTrigger[];
  let variables: GtmVariable[];
  let sourceLabel: string;

  if (opts.snapshot) {
    const filePath = resolve(opts.snapshot);
    if (!existsSync(filePath)) {
      throw new Error(`Snapshot not found: ${filePath}`);
    }
    const snap = JSON.parse(readFileSync(filePath, "utf-8")) as GtmSnapshot;
    tags = snap.tags;
    triggers = snap.triggers;
    variables = snap.variables;
    sourceLabel = opts.snapshot;
  } else {
    tags = await listTags();
    triggers = await listTriggers();
    variables = await listVariables();
    sourceLabel = "Live Workspace";

    if (tags.length === 0 && triggers.length === 0) {
      throw new Error("Cannot connect to GTM. Run: tagops auth login");
    }
  }

  const rules = loadLintConfig(opts.config);
  return runLinter(tags, triggers, variables, rules, sourceLabel);
}

export function printLintReport(report: LintReport): void {
  console.log(chalk.bold("\n  GTM Linter Report\n"));
  console.log(`  Source: ${chalk.gray(report.source)}`);
  console.log(`  Rules:  ${report.rulesApplied}\n`);

  if (report.violations.length === 0) {
    console.log(chalk.green.bold("  ✅ PERFECT: No linting violations found!\n"));
    return;
  }

  // Sort: Errors first, then warnings
  const sorted = [...report.violations].sort((a, b) => {
    if (a.level === b.level) return a.resourceType.localeCompare(b.resourceType);
    return a.level === "error" ? -1 : 1;
  });

  for (const v of sorted) {
    const icon = v.level === "error" ? chalk.red("✖") : chalk.yellow("⚠");
    const label = v.level === "error" ? chalk.red("ERROR") : chalk.yellow("WARN");
    const typeLabel = chalk.gray(`[${v.resourceType}]`);

    console.log(
      `  ${icon} ${label} ${typeLabel} ${v.resourceName} ${chalk.gray(`(${v.resourceId})`)}`,
    );
    console.log(`      ${v.message}`);
    console.log(`      ${chalk.gray(`Rule: ${v.rule}`)}\n`);
  }

  const color = report.passed ? chalk.yellow : chalk.red;
  console.log(
    color.bold(
      `  ✖ Found ${report.summary.errors} error(s) and ${report.summary.warnings} warning(s).\n`,
    ),
  );
}
