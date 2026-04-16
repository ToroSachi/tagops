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
    .option("--report", "Generate a shareable Markdown compliance report")
    .option("--output <file>", "Output path for the report (default: consent-report-<date>.md)")
    .option(
      "--monthly-conversions <n>",
      "Monthly GA4/Ads conversions — enables the EU data-loss exposure estimate",
      (v: string) => Number.parseFloat(v),
    )
    .option(
      "--avg-value <n>",
      "Average conversion value (dollars or the --currency unit) — required with --monthly-conversions",
      (v: string) => Number.parseFloat(v),
    )
    .option(
      "--eea-share <0-1>",
      "Fraction of traffic from EEA/UK (default: 0.3)",
      (v: string) => Number.parseFloat(v),
      0.3,
    )
    .option(
      "--currency <symbol>",
      "Currency symbol to render in the savings estimate (cosmetic)",
      "$",
    )
    .action(
      async (opts: {
        fix?: boolean;
        dryRun?: boolean;
        scoreOnly?: boolean;
        report?: boolean;
        output?: string;
        monthlyConversions?: number;
        avgValue?: number;
        eeaShare?: number;
        currency?: string;
      }) => {
        const {
          auditConsentV2,
          fixConsentV2,
          printConsentReport,
          runConsentReport,
          printConsentReportResult,
          estimateEuDataLoss,
          printSavingsEstimate,
        } = await import("../tools/consent-audit.js");

        const wantsSavings = opts.monthlyConversions !== undefined || opts.avgValue !== undefined;
        if (wantsSavings && (!opts.monthlyConversions || !opts.avgValue)) {
          console.error(
            chalk.red(
              "\n✖ --monthly-conversions and --avg-value must be provided together to estimate savings.\n",
            ),
          );
          process.exit(1);
        }

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
          } else if (opts.report || opts.output) {
            // Load container info for the report header
            let containerInfo: { accountId?: string; containerId?: string } | undefined;
            try {
              const { loadConfig } = await import("../lib/config.js");
              const config = loadConfig();
              containerInfo = {
                accountId: config.accountId,
                containerId: config.containerId,
              };
            } catch {
              // Config may not exist — report works without it
            }

            const result = await runConsentReport(opts.output, containerInfo);
            if (program.opts().json) {
              console.log(JSON.stringify(result, null, 2));
            } else {
              printConsentReportResult(result);
            }
            if (result.complianceScore < 100) process.exit(1);
          } else {
            const report = await auditConsentV2();
            if (opts.scoreOnly) {
              console.log(report.complianceScore);
              if (report.complianceScore < 100) process.exit(1);
            } else if (program.opts().json) {
              const payload: Record<string, unknown> = { ...report };
              if (wantsSavings) {
                payload.savingsEstimate = estimateEuDataLoss(report, {
                  monthlyConversions: opts.monthlyConversions!,
                  avgValue: opts.avgValue!,
                  eeaShare: opts.eeaShare ?? 0.3,
                  currency: opts.currency,
                });
              }
              console.log(JSON.stringify(payload, null, 2));
            } else {
              printConsentReport(report);
              if (wantsSavings) {
                const estimate = estimateEuDataLoss(report, {
                  monthlyConversions: opts.monthlyConversions!,
                  avgValue: opts.avgValue!,
                  eeaShare: opts.eeaShare ?? 0.3,
                  currency: opts.currency,
                });
                printSavingsEstimate(estimate);
              }
              if (report.complianceScore < 100) process.exit(1);
            }
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );
}
