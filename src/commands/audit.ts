import { Command } from "commander";
import chalk from "chalk";

export function registerAuditCommand(program: Command) {
  program
    .command("audit")
    .description("Audit the GTM workspace for misconfigurations")
    .option("--fix", "Interactively fix solvable issues (e.g. unused variables, orphaned triggers)")
    .action(async (opts: { fix?: boolean }) => {
      const { auditWorkspace, printAuditReport, runInteractiveFix } =
        await import("../tools/audit.js");
      try {
        const report = await auditWorkspace();
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printAuditReport(report);
          if (opts.fix) {
            await runInteractiveFix(report);
          }
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}

export function registerConsentAuditCommand(program: Command) {
  program
    .command("consent-audit")
    .description("Deep audit of Consent Mode v2 compliance across all tags")
    .option("--fix", "Auto-fix non-compliant tags by adding required consent signals")
    .option("--dry-run", "Preview fixes without applying them")
    .option("--score-only", "Print only the compliance score (useful for CI gates)")
    .action(async (opts: { fix?: boolean; dryRun?: boolean; scoreOnly?: boolean }) => {
      const { auditConsentV2, fixConsentV2, printConsentReport } =
        await import("../tools/consent-audit.js");
      try {
        if (opts.fix || opts.dryRun) {
          const result = await fixConsentV2(!!opts.dryRun);
          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            for (const action of result.actions) console.log(`  ${action}`);
            console.log(
              `\n  Fixed: ${result.fixed} | Skipped: ${result.skipped} | Errors: ${result.errors}`,
            );
          }
        } else {
          const report = await auditConsentV2();
          if (opts.scoreOnly) {
            console.log(report.complianceScore);
            if (report.complianceScore < 100) process.exit(1);
          } else if (program.opts().json) {
            console.log(JSON.stringify(report, null, 2));
          } else {
            printConsentReport(report);
            if (report.complianceScore < 100) process.exit(1);
          }
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
