import { Command } from "commander";
import chalk from "chalk";

export function registerDeployCommand(program: Command) {
  program
    .command("deploy [manifest]")
    .description("Batch install templates from a manifest file (deploy.json)")
    .option("--dry-run", "Preview what would be created without making changes")
    .option("--init", "Create a starter deploy.json manifest with all templates")
    .action(async (manifest: string | undefined, opts: { dryRun?: boolean; init?: boolean }) => {
      const { deployManifest, printDeployResult, createStarterManifest } =
        await import("../tools/deploy.js");
      try {
        if (opts.init) {
          const path = createStarterManifest(manifest);
          if (program.opts().json) {
            console.log(JSON.stringify({ created: path }));
          } else {
            console.log(chalk.green(`\n  ✔ Created ${path}\n`));
            console.log(
              "  Edit the file to configure your pixel IDs and enable the templates you need.",
            );
            console.log("  Then run:");
            console.log(chalk.cyan(`    tagops deploy ${path} --dry-run\n`));
          }
          return;
        }

        if (!manifest) {
          console.error(
            chalk.red("\n✖ Please specify a manifest file: tagops deploy manifest.json"),
          );
          console.log("  Or create one: tagops deploy --init\n");
          process.exit(1);
        }

        const result = await deployManifest(manifest, { dryRun: opts.dryRun });
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printDeployResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
