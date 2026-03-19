import { Command } from "commander";
import chalk from "chalk";
import { existsSync } from "node:fs";

export function registerAuthCommands(program: Command) {
  const authCmd = program.command("auth").description("Authentication management");

  authCmd
    .command("login")
    .description("Authenticate with Google via browser OAuth or a Service Account key file")
    .option("--key-file <path>", "Path to your Service Account JSON key (for CI/CD)")
    .action(async (opts: { keyFile?: string }) => {
      if (opts.keyFile) {
        if (!existsSync(opts.keyFile)) {
          console.error(chalk.red(`\n✖ Key file not found at: ${opts.keyFile}`));
          process.exit(1);
        }
        console.log(chalk.green(`\n✔ Authentication configured via Service Account key.`));
        console.log(`Add this to your shell profile to make it permanent:`);
        console.log(chalk.cyan(`  export GOOGLE_APPLICATION_CREDENTIALS="${opts.keyFile}"\n`));
      } else {
        const { loginWithOAuth } = await import("../lib/auth.js");
        const result = await loginWithOAuth();
        if (result.success) {
          console.log(chalk.green(`\n  ✔ Authenticated successfully!`));
          console.log(`  Credentials saved to ~/.tagops-credentials.json`);
          console.log(`\n  Next steps:`);
          console.log(chalk.cyan(`    tagops status`));
          console.log(chalk.cyan(`    tagops audit\n`));
        } else {
          console.error(chalk.red(`\n  ✖ Authentication failed: ${result.error}\n`));
          process.exit(1);
        }
      }
    });

  authCmd
    .command("import")
    .description("Import credentials from @owntag/gtm-cli (if already authenticated there)")
    .action(async () => {
      const { importFromGtmCli } = await import("../lib/auth.js");
      const result = await importFromGtmCli();
      if (result.success) {
        console.log(chalk.green(`\n  ✔ ${result.message}\n`));
      } else {
        console.error(chalk.red(`\n  ✖ ${result.message}\n`));
        process.exit(1);
      }
    });

  authCmd
    .command("status")
    .description("Check your current Google API authentication status")
    .action(async () => {
      const { checkAuthStatus, promptAuthLogin } = await import("../lib/auth.js");
      const status = await checkAuthStatus();
      console.log(chalk.bold("\n  GTM API Authentication Status\n"));
      if (status.authenticated) {
        console.log(`  Status: ${chalk.green("Authenticated")}`);
        console.log(`  Method: ${chalk.cyan(status.method)}\n`);
      } else {
        console.log(`  Status: ${chalk.red("Not Authenticated")}`);
        console.log(`  Error:  ${status.error || "No valid credentials found"}\n`);
        console.log(promptAuthLogin());
      }
    });
}
