import { Command } from "commander";
import chalk from "chalk";

// Local error handlers removed in favor of global handleError in cli.ts
export function registerWorkspaceCommands(program: Command) {
  const workspaceCmd = program.command("workspace").description("Manage GTM draft workspaces");

  workspaceCmd
    .command("list")
    .description("List all draft workspaces in the current container")
    .action(async () => {
      const { listWorkspaces } = await import("../lib/gtm-cli.js");
      const workspaces = await listWorkspaces();
      console.log(chalk.bold("\n  GTM Draft Workspaces\n"));
      if (workspaces.length === 0) {
        console.log("  No draft workspaces found.");
      } else {
        for (const w of workspaces) {
          console.log(`  ID: ${chalk.cyan(String(w.workspaceId).padEnd(12))} Name: ${w.name}`);
        }
      }
      console.log("");
    });

  workspaceCmd
    .command("select <id>")
    .description("Switch the CLI to a different workspace ID")
    .action(async (id: string) => {
      const { loadConfig, writeConfig, normalizeProfileName } = await import("../lib/config.js");
      const { listWorkspaces } = await import("../lib/gtm-cli.js");
      const globalProfile = program.opts().profile as string | undefined;
      const normalizedProfile = normalizeProfileName(globalProfile);

      const config = loadConfig("default");
      if (normalizedProfile) {
        loadConfig(normalizedProfile);
      }
      const workspaces = await listWorkspaces();
      if (!workspaces.some((w) => w.workspaceId === id)) {
        console.error(chalk.red(`\n✖ Workspace ID ${id} not found in this container.`));
        console.log(`  Run ${chalk.cyan("tagops workspace list")} to see available workspaces.\n`);
        process.exit(1);
      }

      if (normalizedProfile) {
        const profile = config.profiles?.find((entry) => entry.name === normalizedProfile);
        if (!profile) {
          console.error(chalk.red(`\n✖ Profile "${normalizedProfile}" not found.`));
          process.exit(1);
        }
        profile.workspaceId = id;
      } else {
        config.workspaceId = id;
      }

      writeConfig(config);
      console.log(chalk.green(`\n✔ Switched to workspace ${id}\n`));
    });
}
