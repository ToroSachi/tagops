import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import chalk from "chalk";
import { configureApiConcurrency, parseConcurrencyOption } from "../lib/concurrency.js";
import { resolveProjectPath } from "../lib/path-safety.js";
import { getSafeErrorMessage } from "../lib/redaction.js";
import type { PlanRiskLevel } from "../tools/plan.js";

function riskColor(riskLevel: PlanRiskLevel): (text: string) => string {
  switch (riskLevel) {
    case "low":
      return chalk.green;
    case "medium":
      return chalk.yellow;
    case "high":
      return chalk.hex("#ff8c00");
    case "critical":
      return chalk.red;
  }
}

async function confirmRiskyRestore(riskLevel: PlanRiskLevel, useStderr = false): Promise<boolean> {
  if (!process.stdin.isTTY) {
    throw new Error(
      `${riskLevel.toUpperCase()} risk restore requires interactive confirmation on stdin.`,
    );
  }

  const rl = createInterface({
    input: process.stdin,
    output: useStderr ? process.stderr : process.stdout,
  });

  try {
    const answer = await rl.question(
      riskColor(riskLevel)(
        `\n  ${riskLevel.toUpperCase()} risk restore plan detected. Continue? [y/N]: `,
      ),
    );
    const normalized = answer.trim().toLowerCase();
    return normalized === "y" || normalized === "yes";
  } finally {
    rl.close();
  }
}

export function registerIaCCommands(program: Command) {
  program
    .command("snapshot")
    .description("Save a full workspace snapshot (infrastructure-as-code)")
    .option("--output <file>", "Output file path (default: gtm-snapshot.json)")
    .action(async (opts: { output?: string }) => {
      const { takeSnapshot, printSnapshotResult } = await import("../tools/snapshot.js");
      try {
        const outputPath = opts.output
          ? resolveProjectPath(opts.output, "Snapshot output")
          : undefined;
        const result = await takeSnapshot(outputPath);
        if (program.opts().json) {
          console.log(
            JSON.stringify({
              path: result.path,
              tags: result.tagCount,
              triggers: result.triggerCount,
              variables: result.variableCount,
              folders: result.folderCount,
              builtInVariables: result.builtInVariableCount,
              clients: result.clientCount,
              environments: result.environmentCount,
              transformations: result.transformationCount,
              sizeBytes: result.sizeBytes,
              warning: result.warning,
            }),
          );
        } else {
          printSnapshotResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${getSafeErrorMessage(err)}`));
        process.exit(1);
      }
    });

  program
    .command("diff")
    .description("Compare current workspace against a snapshot")
    .option(
      "--snapshot <file>",
      "Snapshot file to compare against (default: latest gtm-snapshot.json)",
    )
    .action(async (opts: { snapshot?: string }) => {
      const { diffWorkspace, printDiffReport } = await import("../tools/diff.js");
      try {
        const snapshotPath = opts.snapshot
          ? resolveProjectPath(opts.snapshot, "Snapshot")
          : undefined;
        const report = await diffWorkspace(snapshotPath);
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printDiffReport(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${getSafeErrorMessage(err)}`));
        process.exit(1);
      }
    });

  program
    .command("plan <snapshot>")
    .description("Preview the restore plan for a snapshot against the live workspace")
    .action(async (snapshot: string) => {
      const { plan, printPlan } = await import("../tools/plan.js");
      try {
        const snapshotPath = resolveProjectPath(snapshot, "Snapshot");
        const result = await plan(snapshotPath);
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printPlan(result);
        }
        if (result.riskLevel === "critical") process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${getSafeErrorMessage(err)}`));
        process.exit(1);
      }
    });

  program
    .command("restore <file>")
    .description("Restore workspace from a snapshot file")
    .option("--dry-run", "Preview what would change without making modifications")
    .option("--delete", "Delete resources that aren't in the snapshot")
    .option(
      "--concurrency <n>",
      "Maximum concurrent GTM API requests (default: 5)",
      parseConcurrencyOption,
    )
    .action(
      async (file: string, opts: { dryRun?: boolean; delete?: boolean; concurrency?: number }) => {
        const { plan, printPlan } = await import("../tools/plan.js");
        const { restoreWorkspace, printRestoreResult } = await import("../tools/restore.js");
        try {
          const snapshotPath = resolveProjectPath(file, "Snapshot");
          configureApiConcurrency(opts.concurrency);
          const jsonOutput = Boolean(program.opts().json);
          const restorePlan = await plan(snapshotPath, {
            allowDelete: opts.delete ?? false,
            includeFolders: true,
          });

          if (!jsonOutput) {
            printPlan(restorePlan);
          }

          if (
            !opts.dryRun &&
            (restorePlan.riskLevel === "high" || restorePlan.riskLevel === "critical")
          ) {
            const confirmed = await confirmRiskyRestore(restorePlan.riskLevel, jsonOutput);
            if (!confirmed) {
              console.error(chalk.red("\n✖ Restore aborted.\n"));
              process.exit(1);
            }
          }

          const result = await restoreWorkspace(snapshotPath, {
            dryRun: opts.dryRun ?? false,
            allowDelete: opts.delete ?? false,
            concurrency: opts.concurrency,
          });
          if (jsonOutput) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printRestoreResult(result);
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${getSafeErrorMessage(err)}`));
          process.exit(1);
        }
      },
    );

  program
    .command("publish")
    .description("Create and optionally publish a new GTM workspace version")
    .requiredOption("--name <name>", "Version name (e.g., 'v1.5 — Meta Pixel Fix')")
    .option("--description <desc>", "Version description")
    .option(
      "--confirm",
      "Actually publish the version live (without this, only creates the version)",
    )
    .option("--dry-run", "Preview what would happen without making changes")
    .action(
      async (opts: { name: string; description?: string; confirm?: boolean; dryRun?: boolean }) => {
        const { runPublish, printPublishResult } = await import("../tools/publish.js");
        try {
          if (!program.opts().json && !opts.dryRun)
            console.log(chalk.bold("\n=== GTM Workspace Publish ===\n"));
          const result = await runPublish({
            name: opts.name,
            description: opts.description,
            confirm: opts.confirm,
            dryRun: opts.dryRun,
          });
          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printPublishResult(result);
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${getSafeErrorMessage(err)}`));
          process.exit(1);
        }
      },
    );
}
