import { Command } from "commander";
import chalk from "chalk";

export function registerGovernanceCommands(program: Command) {
  program
    .command("policies")
    .description("List available preset policy packs for compliance and governance")
    .action(async () => {
      const { listPolicyPacks } = await import("../lib/policy-packs.js");
      const packs = listPolicyPacks();

      if (program.opts().json) {
        console.log(
          JSON.stringify(
            packs.map((p) => ({ name: p.name, title: p.title, description: p.description })),
            null,
            2,
          ),
        );
        return;
      }

      console.log(chalk.bold("\n  Available Policy Packs\n"));
      for (const pack of packs) {
        console.log(`  ${chalk.cyan(pack.name)}  —  ${pack.title}`);
        console.log(`    ${chalk.dim(pack.description)}\n`);
      }
      console.log(chalk.bold("  Usage:"));
      console.log(chalk.cyan("    tagops init --policies gdpr-strict"));
      console.log(chalk.cyan("    tagops init --policies ccpa-baseline"));
      console.log(chalk.cyan("    tagops init --policies agency-standard\n"));
    });

  program
    .command("policy-check")
    .description("Run policy pack checks against a GTM workspace")
    .option("--config <file>", "Policy config file (default: .tagops-policies.json)")
    .action(async (opts: { config?: string }) => {
      const [{ evaluatePolicies, loadPoliciesFromConfig, printPolicyReport }, gtmCli] =
        await Promise.all([import("../lib/policies.js"), import("../lib/gtm-cli.js")]);
      try {
        const [tags, triggers, variables] = await Promise.all([
          gtmCli.listTags(),
          gtmCli.listTriggers(),
          gtmCli.listVariables(),
        ]);

        if (tags.length === 0 && triggers.length === 0) {
          throw new Error("Cannot connect to GTM. Run: tagops auth login");
        }

        const policies = loadPoliciesFromConfig(opts.config);
        const report = evaluatePolicies(tags, triggers, variables, policies);

        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printPolicyReport(report);
        }

        if (!report.passed) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("lint")
    .description("Run configurable compliance checks against a GTM workspace")
    .option("--config <file>", "Lint config file (default: gtm-lint.json)")
    .option("--snapshot <file>", "Run linter against a saved snapshot instead of live workspace")
    .action(async (opts: { config?: string; snapshot?: string }) => {
      const { lintWorkspace, printLintReport } = await import("../tools/lint.js");
      try {
        const report = await lintWorkspace({ config: opts.config, snapshot: opts.snapshot });
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printLintReport(report);
        }
        if (!report.passed) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
