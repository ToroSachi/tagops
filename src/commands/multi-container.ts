import { Command } from "commander";
import chalk from "chalk";

export function registerMultiContainerCommands(program: Command) {
  program
    .command("compare")
    .description("Compare two GTM containers side-by-side using profiles")
    .requiredOption("--source <profile>", "Source profile name")
    .requiredOption("--target <profile>", "Target profile name")
    .action(async (opts: { source: string; target: string }) => {
      const { compareContainers, printCompareReport } = await import("../tools/compare.js");
      try {
        const report = await compareContainers(opts.source, opts.target);
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printCompareReport(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("sync")
    .description("Sync tags, triggers, and variables from source profile to target profile")
    .requiredOption("--source <profile>", "Source profile name")
    .requiredOption("--target <profile>", "Target profile name")
    .option("--dry-run", "Preview changes without syncing")
    .option("--force", "Skip confirmation prompt")
    .action(async (opts: { source: string; target: string; dryRun?: boolean; force?: boolean }) => {
      const { syncContainers } = await import("../tools/sync.js");
      try {
        const result = await syncContainers({
          source: opts.source,
          target: opts.target,
          dryRun: !!opts.dryRun,
          force: !!opts.force,
        });
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        }
        if (result.errors.length > 0) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
