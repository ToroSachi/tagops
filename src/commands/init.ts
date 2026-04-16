import { Command } from "commander";
import chalk from "chalk";

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize a .gtmrc.json config file for your GTM container")
    .option("--account-id <id>", "GTM Account ID")
    .option("--container-id <id>", "GTM Container ID")
    .option("--workspace-id <id>", "GTM Workspace ID")
    .option(
      "--import",
      "After writing config, snapshot the live container and run a Consent Mode v2 audit",
    )
    .option(
      "--monthly-conversions <n>",
      "With --import: estimate dollar exposure from consent gaps",
      (v: string) => Number.parseFloat(v),
    )
    .option(
      "--avg-value <n>",
      "With --import: average conversion value for the exposure estimate",
      (v: string) => Number.parseFloat(v),
    )
    .option(
      "--eea-share <0-1>",
      "With --import: fraction of traffic from EEA/UK (default: 0.3)",
      (v: string) => Number.parseFloat(v),
      0.3,
    )
    .option("--ci", "Scaffold TagOps project files and GitHub Actions workflows")
    .option("--branch <name>", "Target branch for generated CI workflows", "main")
    .option(
      "--policies <pack>",
      "Install a preset policy pack: gdpr-strict, ccpa-baseline, agency-standard",
    )
    .action(
      async (opts: {
        accountId?: string;
        containerId?: string;
        workspaceId?: string;
        import?: boolean;
        monthlyConversions?: number;
        avgValue?: number;
        eeaShare?: number;
        ci?: boolean;
        branch?: string;
        policies?: string;
      }) => {
        const hasAnyIds = Boolean(opts.accountId || opts.containerId || opts.workspaceId);
        const hasAllIds = Boolean(opts.accountId && opts.containerId && opts.workspaceId);

        if (hasAnyIds && !hasAllIds) {
          console.error(
            chalk.red(
              "\n✖ --account-id, --container-id, and --workspace-id must be provided together.\n",
            ),
          );
          process.exit(1);
        }

        if (opts.import) {
          if (!hasAllIds) {
            console.error(
              chalk.red(
                "\n✖ --import requires --account-id, --container-id, and --workspace-id.\n",
              ),
            );
            process.exit(1);
          }
          const wantsSavings = opts.monthlyConversions !== undefined || opts.avgValue !== undefined;
          if (wantsSavings && (!opts.monthlyConversions || !opts.avgValue)) {
            console.error(
              chalk.red("\n✖ --monthly-conversions and --avg-value must be provided together.\n"),
            );
            process.exit(1);
          }

          const { runInitImport, printInitImportResult } = await import("../tools/init-import.js");
          try {
            if (!program.opts().json) {
              console.log(chalk.bold("\n  Importing container...\n"));
            }
            const result = await runInitImport({
              accountId: opts.accountId!,
              containerId: opts.containerId!,
              workspaceId: opts.workspaceId!,
              savings: wantsSavings
                ? {
                    monthlyConversions: opts.monthlyConversions!,
                    avgValue: opts.avgValue!,
                    eeaShare: opts.eeaShare,
                  }
                : undefined,
            });
            if (program.opts().json) {
              console.log(JSON.stringify(result, null, 2));
            } else {
              printInitImportResult(result);
            }
          } catch (err) {
            console.error(chalk.red(`\n✖ ${(err as Error).message}`));
            process.exit(1);
          }
          return;
        }

        if (opts.ci || opts.policies) {
          const { initProject, printInitProjectReport } = await import("../tools/init-project.js");
          const report = initProject({
            accountId: opts.accountId,
            containerId: opts.containerId,
            workspaceId: opts.workspaceId,
            ci: opts.ci ?? false,
            branch: opts.branch,
            policies: opts.policies,
          });

          if (program.opts().json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            printInitProjectReport(report);
          }
          return;
        }

        const { hasConfig, loadConfig, writeConfig } = await import("../lib/config.js");
        const existingConfig = hasConfig() ? loadConfig("default") : undefined;

        const config = {
          ...existingConfig,
          accountId: opts.accountId ?? "",
          containerId: opts.containerId ?? "",
          workspaceId: opts.workspaceId ?? "",
        };

        if (!config.accountId || !config.containerId || !config.workspaceId) {
          console.log(chalk.bold("\n  TagOps — Init\n"));
          console.log("  Create a .gtmrc.json config file for your container.\n");
          console.log("  Find your IDs by running:");
          console.log(chalk.cyan("    gtm accounts list"));
          console.log(chalk.cyan("    gtm containers list --account-id <ACCOUNT_ID>"));
          console.log(chalk.cyan("    gtm workspaces list\n"));
          console.log("  Then run:");
          console.log(
            chalk.cyan(
              "    tagops init --account-id <ID> --container-id <ID> --workspace-id <ID>\n",
            ),
          );
          return;
        }

        const configPath = writeConfig(config);
        if (program.opts().json) {
          console.log(JSON.stringify({ created: configPath, config }));
        } else {
          console.log(chalk.green(`\n  ✔ Created ${configPath}\n`));
          console.log("  Next steps:");
          console.log(chalk.cyan("    tagops status"));
          console.log(chalk.cyan("    tagops audit\n"));
        }
      },
    );
}
