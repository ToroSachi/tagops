import { Command } from "commander";
import chalk from "chalk";
import { parseConcurrencyOption } from "../lib/concurrency.js";
import { getSafeErrorMessage } from "../lib/redaction.js";
import { getProfileEnvironment, validatePromotionFlow } from "../lib/config.js";

export function registerMultiContainerCommands(program: Command) {
  program
    .command("promote")
    .description("Promote GTM changes from one environment profile to the next")
    .requiredOption("--source <profile>", "Source profile name")
    .requiredOption("--target <profile>", "Target profile name")
    .option("--publish", "Create a version and publish it in the target after sync")
    .option("--dry-run", "Preview the promotion plan without applying changes")
    .option("--force", "Skip confirmation prompt during sync")
    .option(
      "--concurrency <n>",
      "Maximum concurrent GTM API requests (default: 5)",
      parseConcurrencyOption,
    )
    .action(
      async (opts: {
        source: string;
        target: string;
        publish?: boolean;
        dryRun?: boolean;
        force?: boolean;
        concurrency?: number;
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
            concurrency: opts.concurrency,
          });

          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          }

          if (result.errors.length > 0) {
            process.exit(1);
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${getSafeErrorMessage(err)}`));
          process.exit(1);
        }
      },
    );
}
