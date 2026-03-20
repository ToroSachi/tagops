import { Command } from "commander";
import chalk from "chalk";

export function registerProfileCommand(program: Command) {
  program
    .command("profiles")
    .description("List available container profiles from .gtmrc.json")
    .action(async () => {
      const { listProfiles, loadConfig } = await import("../lib/config.js");
      const globalProfile = program.opts().profile as string | undefined;
      const profiles = listProfiles();
      if (program.opts().json) {
        const config = loadConfig(globalProfile);
        console.log(JSON.stringify(config.profiles ?? [], null, 2));
      } else if (profiles.length === 0) {
        console.log(chalk.yellow("\n  No profiles configured.\n"));
        console.log("  Add profiles to .gtmrc.json:");
        console.log(chalk.cyan('    "profiles": ['));
        console.log(
          chalk.cyan(
            '      { "name": "staging", "accountId": "...", "containerId": "...", "workspaceId": "..." }',
          ),
        );
        console.log(chalk.cyan("    ]\n"));
      } else {
        console.log(chalk.bold("\n  Available Profiles:\n"));
        for (const name of profiles) {
          console.log(`    • ${chalk.cyan(name)}`);
        }
        console.log(`\n  Use: ${chalk.cyan("tagops --profile <name> <command>")}\n`);
      }
    });
}
