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
    .command("status")
    .description("Show workspace sync state, merge conflicts, and pending changes")
    .action(async () => {
      const { getWorkspaceStatus } = await import("../lib/gtm-cli.js");
      const status = await getWorkspaceStatus();
      const summary = {
        synced: status.synced,
        mergeConflict: status.mergeConflict,
        workspaceChange: status.workspaceChange,
        mergeConflicts: status.mergeConflict.length,
        pendingChanges: status.workspaceChange.length,
      };

      if (program.opts().json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(chalk.bold("\n  GTM Workspace Status\n"));
      console.log(`  Synced:           ${status.synced ? chalk.green("Yes") : chalk.yellow("No")}`);
      console.log(`  Merge conflicts:  ${status.mergeConflict.length}`);
      console.log(`  Pending changes:  ${status.workspaceChange.length}`);
      console.log("");
    });

  workspaceCmd
    .command("create <name>")
    .description("Create a new isolated draft workspace")
    .option("-d, --description <text>", "Optional workspace description")
    .action(async (name: string, opts: { description?: string }) => {
      const { createWorkspace } = await import("../lib/gtm-cli.js");
      const workspace = await createWorkspace(name, opts.description);

      if (program.opts().json) {
        console.log(JSON.stringify(workspace, null, 2));
        return;
      }

      console.log(chalk.green(`\n✔ Created workspace "${workspace.name ?? name}"`));
      console.log(`  ID:   ${chalk.cyan(workspace.workspaceId ?? "unknown")}`);
      if (workspace.description) {
        console.log(`  Desc: ${workspace.description}`);
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

  workspaceCmd
    .command("sync")
    .description("Sync the current workspace with the latest container version")
    .action(async () => {
      const { syncWorkspace } = await import("../lib/gtm-cli.js");
      const result = await syncWorkspace();
      const mergeConflict = result.mergeConflict ?? [];
      const syncStatus = result.syncStatus;
      const synced =
        !syncStatus?.mergeConflict && !syncStatus?.syncError && mergeConflict.length === 0;
      const summary = {
        synced,
        mergeConflict,
        syncStatus,
      };

      if (program.opts().json) {
        console.log(JSON.stringify(summary, null, 2));
        return;
      }

      console.log(chalk.bold("\n  GTM Workspace Sync\n"));
      console.log(
        `  Synced:           ${synced ? chalk.green("Yes") : chalk.yellow("Needs attention")}`,
      );
      console.log(`  Merge conflicts:  ${mergeConflict.length}`);
      console.log(
        `  Sync error:       ${syncStatus?.syncError ? chalk.red("Yes") : chalk.green("No")}`,
      );
      console.log("");
    });

  workspaceCmd
    .command("delete <id>")
    .description("Delete a draft workspace")
    .action(async (id: string) => {
      const { deleteWorkspace } = await import("../lib/gtm-cli.js");
      const deleted = await deleteWorkspace(id);

      if (!deleted) {
        console.error(chalk.red(`\n✖ Workspace ID ${id} not found.`));
        process.exit(1);
      }

      if (program.opts().json) {
        console.log(JSON.stringify({ workspaceId: id, deleted: true }, null, 2));
        return;
      }

      console.log(chalk.green(`\n✔ Deleted workspace ${id}\n`));
    });
}
