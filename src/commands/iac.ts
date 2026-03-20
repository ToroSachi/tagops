import { createInterface } from "node:readline/promises";
import { Command } from "commander";
import chalk from "chalk";
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
        const result = await takeSnapshot(opts.output);
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
            }),
          );
        } else {
          printSnapshotResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
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
        const report = await diffWorkspace(opts.snapshot);
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printDiffReport(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("plan <snapshot>")
    .description("Preview the restore plan for a snapshot against the live workspace")
    .action(async (snapshot: string) => {
      const { plan, printPlan } = await import("../tools/plan.js");
      try {
        const result = await plan(snapshot);
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printPlan(result);
        }
        if (result.riskLevel === "critical") process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("changelog")
    .description(
      "Generate a human-readable changelog between two snapshots (or snapshot vs current)",
    )
    .option("--from <file>", "Older snapshot file (default: gtm-snapshot.json)")
    .option("--to <file>", "Newer snapshot file (default: current live workspace)")
    .option("--output <file>", "Write changelog to a markdown file")
    .action(async (opts: { from?: string; to?: string; output?: string }) => {
      const { generateChangelog, renderChangelogMarkdown, printChangelog } =
        await import("../tools/changelog.js");
      const { writeFileSync } = await import("node:fs");
      try {
        const report = await generateChangelog({ from: opts.from, to: opts.to });
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else if (opts.output) {
          const md = renderChangelogMarkdown(report);
          writeFileSync(opts.output, md);
          console.log(chalk.green(`\n  ✔ Changelog written to ${opts.output}\n`));
        } else {
          printChangelog(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("undo")
    .description(
      "List recent pre-fix backups and restore from one (undo a fix-firing or consent-audit --fix)",
    )
    .option("--list", "Only list available backups without restoring")
    .action(async (opts: { list?: boolean }) => {
      const { listPreFixBackups } = await import("../lib/pre-fix-backup.js");
      const backups = listPreFixBackups();

      if (backups.length === 0) {
        console.log(
          chalk.yellow(
            "\n  No pre-fix backups found. Fix tools automatically create backups before writing.\n",
          ),
        );
        return;
      }

      console.log(chalk.bold("\n  Recent Pre-Fix Backups\n"));
      for (const [i, b] of backups.entries()) {
        console.log(`  ${chalk.cyan(String(i + 1))}. ${b.timestamp} — ${b.toolName}`);
        console.log(`     ${chalk.gray(b.path)}`);
      }

      if (opts.list) {
        console.log();
        return;
      }

      const latest = backups[0];
      console.log(`\n  Restoring from: ${chalk.cyan(latest.toolName)} (${latest.timestamp})`);
      console.log(chalk.gray(`  ${latest.path}\n`));

      const { restoreWorkspace, printRestoreResult } = await import("../tools/restore.js");
      try {
        const result = await restoreWorkspace(latest.path, { dryRun: false, allowDelete: true });
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printRestoreResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("restore <file>")
    .description("Restore workspace from a snapshot file")
    .option("--dry-run", "Preview what would change without making modifications")
    .option("--delete", "Delete resources that aren't in the snapshot")
    .action(async (file: string, opts: { dryRun?: boolean; delete?: boolean }) => {
      const { plan, printPlan } = await import("../tools/plan.js");
      const { restoreWorkspace, printRestoreResult } = await import("../tools/restore.js");
      try {
        const jsonOutput = Boolean(program.opts().json);
        const restorePlan = await plan(file, {
          allowDelete: opts.delete ?? false,
          includeFolders: false,
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

        const result = await restoreWorkspace(file, {
          dryRun: opts.dryRun ?? false,
          allowDelete: opts.delete ?? false,
        });
        if (jsonOutput) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printRestoreResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

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
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );

  program
    .command("versions")
    .description("List recent GTM container versions")
    .option(
      "--limit <n>",
      "Maximum number of versions to show (default: 10)",
      (value: string) => Number.parseInt(value, 10),
      10,
    )
    .action(async (opts: { limit?: number }) => {
      const { listVersionHistory, printVersionHistory } = await import("../tools/rollback.js");
      try {
        const result = await listVersionHistory(opts.limit);
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printVersionHistory(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("rollback <version-id>")
    .description("Re-publish a historical GTM container version")
    .option("--dry-run", "Preview the rollback without publishing it live")
    .action(async (versionId: string, opts: { dryRun?: boolean }) => {
      const { rollback, printRollbackResult } = await import("../tools/rollback.js");
      try {
        const result = await rollback(versionId, { dryRun: opts.dryRun ?? false });
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printRollbackResult(result);
        }

        if (result.error) {
          process.exit(1);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
