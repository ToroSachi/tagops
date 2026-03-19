import { Command } from "commander";
import chalk from "chalk";

export function registerInitCommand(program: Command) {
  program
    .command("init")
    .description("Initialize a .gtmrc.json config file for your GTM container")
    .option("--account-id <id>", "GTM Account ID")
    .option("--container-id <id>", "GTM Container ID")
    .option("--workspace-id <id>", "GTM Workspace ID", "37")
    .action(async (opts: { accountId?: string; containerId?: string; workspaceId: string }) => {
      const { writeConfig } = await import("../lib/config.js");
      const config = {
        accountId: opts.accountId ?? "",
        containerId: opts.containerId ?? "",
        workspaceId: opts.workspaceId,
      };

      if (!config.accountId || !config.containerId) {
        console.log(chalk.bold("\n  GTM Auto — Init\n"));
        console.log("  Create a .gtmrc.json config file for your container.\n");
        console.log("  Find your IDs by running:");
        console.log(chalk.cyan("    gtm accounts list"));
        console.log(chalk.cyan("    gtm containers list --account-id <ACCOUNT_ID>"));
        console.log(chalk.cyan("    gtm workspaces list\n"));
        console.log("  Then run:");
        console.log(chalk.cyan("    tagops init --account-id <ID> --container-id <ID>\n"));
        return;
      }

      const path = writeConfig(config);
      if (program.opts().json) {
        console.log(JSON.stringify({ created: path, config }));
      } else {
        console.log(chalk.green(`\n  ✔ Created ${path}\n`));
        console.log("  Next steps:");
        console.log(chalk.cyan("    tagops status"));
        console.log(chalk.cyan("    tagops audit\n"));
      }
    });
}
