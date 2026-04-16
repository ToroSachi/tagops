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

          if (
            result.error === "access_denied" ||
            result.error === "admin_policy_enforced" ||
            String(result.error).includes("App Blocked") ||
            String(result.error).includes("policy")
          ) {
            console.log(chalk.yellow(`  ⚠️  App Blocked Error Detected`));
            console.log(
              chalk.white(`  If your Google Workspace is blocking the default OAuth client,`),
            );
            console.log(
              chalk.white(`  the easiest workaround is to use a Service Account instead:`),
            );
            console.log(chalk.cyan(`\n    1. Create a Service Account in Google Cloud Console.`));
            console.log(chalk.cyan(`    2. Download the JSON key file.`));
            console.log(chalk.cyan(`    3. Run: tagops auth login --key-file /path/to/key.json\n`));
          }

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
        if (status.email) {
          console.log(`  Email:  ${chalk.cyan(status.email)}\n`);
        }
      } else {
        console.log(`  Status: ${chalk.red("Not Authenticated")}`);
        console.log(`  Error:  ${status.error || "No valid credentials found"}\n`);
        console.log(promptAuthLogin());
      }
    });

  authCmd
    .command("whoami")
    .description("Show the current authenticated Google identity and GTM permission level")
    .action(async () => {
      const { checkAuthStatus, getCurrentAuthenticatedEmail, promptAuthLogin } =
        await import("../lib/auth.js");
      const gtmCli = await import("../lib/gtm-cli.js");
      const status = await checkAuthStatus();

      if (!status.authenticated) {
        console.log(chalk.bold("\n  Current Identity\n"));
        console.log(`  Status: ${chalk.red("Not Authenticated")}`);
        console.log(`  Error:  ${status.error || "No valid credentials found"}\n`);
        console.log(promptAuthLogin());
        process.exit(1);
      }

      const email = status.email ?? (await getCurrentAuthenticatedEmail()) ?? "unknown";
      let permissionLabel = "unknown";
      let note: string | undefined;

      try {
        const permission = await gtmCli.getCurrentUserPermission();
        if (permission) {
          const containerPermission = gtmCli.getEffectiveContainerPermission(permission);
          permissionLabel = `account=${permission.accountAccess.permission}, container=${containerPermission}`;
        } else {
          note = "Current GTM user permission could not be matched to the authenticated identity.";
        }
      } catch (err) {
        if (
          typeof gtmCli.isPermissionLookupError === "function" &&
          gtmCli.isPermissionLookupError(err)
        ) {
          note = "GTM user permissions could not be inspected with the current credentials.";
        } else if (err instanceof Error && err.message.includes(".gtmrc.json")) {
          note =
            "Configure .gtmrc.json to inspect GTM container permissions for the current account.";
        } else {
          throw err;
        }
      }

      if (program.opts().json) {
        console.log(
          JSON.stringify(
            {
              authenticated: true,
              method: status.method,
              email,
              permission: permissionLabel,
              note,
            },
            null,
            2,
          ),
        );
        return;
      }

      console.log(chalk.bold("\n  Current Identity\n"));
      console.log(`  Status:     ${chalk.green("Authenticated")}`);
      console.log(`  Method:     ${chalk.cyan(status.method)}`);
      console.log(`  Email:      ${chalk.cyan(email)}`);
      console.log(`  Permission: ${chalk.cyan(permissionLabel)}`);
      if (note) {
        console.log(`  Note:       ${chalk.yellow(note)}`);
      }
      console.log();
    });
}
