import { Command } from "commander";
import chalk from "chalk";
import {
  getProfileEnvironment,
  validatePromotionFlow,
  withDefaultProfileName,
} from "../lib/config.js";

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
        const result = await withDefaultProfileName(opts.target, () =>
          syncContainers({
            source: opts.source,
            target: opts.target,
            dryRun: !!opts.dryRun,
            force: !!opts.force || !!program.opts().json,
            silent: !!program.opts().json,
          }),
        );
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        }
        if (result.errors.length > 0) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("promote")
    .description("Promote GTM changes from one environment profile to the next")
    .requiredOption("--source <profile>", "Source profile name")
    .requiredOption("--target <profile>", "Target profile name")
    .option("--publish", "Create a version and publish it in the target after sync")
    .option("--dry-run", "Preview the promotion plan without applying changes")
    .option("--force", "Skip confirmation prompt during sync")
    .action(
      async (opts: {
        source: string;
        target: string;
        publish?: boolean;
        dryRun?: boolean;
        force?: boolean;
      }) => {
        const { promote } = await import("../tools/promote.js");

        try {
          const promotion = validatePromotionFlow(opts.source, opts.target);
          const targetEnvironment =
            getProfileEnvironment(opts.target) ?? promotion.targetEnvironment;

          if (targetEnvironment === "production" && !program.opts().json) {
            console.warn(
              chalk.yellow(
                "\n⚠ Promoting to production. Review the plan carefully before applying changes.\n",
              ),
            );
          }

          const result = await promote(opts.source, opts.target, {
            dryRun: !!opts.dryRun,
            publish: !!opts.publish,
            force: !!opts.force || !!program.opts().json,
            silent: !!program.opts().json,
          });

          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          }

          if (result.errors.length > 0) {
            process.exit(1);
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );
}
