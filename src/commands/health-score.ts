import { Command } from "commander";
import chalk from "chalk";

export function registerHealthCommand(program: Command) {
  program
    .command("health-score")
    .description("Calculate a composite container health score (0-100) with letter grade")
    .action(async () => {
      const { calculateHealthScore, printHealthReport } = await import("../tools/health-score.js");
      const { listTags, listTriggers, listVariables } = await import("../lib/gtm-cli.js");
      try {
        const [tags, triggers, variables] = await Promise.all([
          listTags(),
          listTriggers(),
          listVariables(),
        ]);
        const report = calculateHealthScore(tags, triggers, variables);
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printHealthReport(report);
        }
        if (report.overallScore < 50) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}

export function registerReportCommand(program: Command) {
  program
    .command("report")
    .description("Generate a professional Markdown quality report for clients")
    .option("-o, --output <path>", "Output path for the report")
    .action(async (opts: { output?: string }) => {
      const { runReport, printReportResult } = await import("../tools/report.js");
      try {
        const result = await runReport(opts.output);
        printReportResult(result);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
