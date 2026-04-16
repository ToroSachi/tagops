import { Command } from "commander";
import chalk from "chalk";

export function registerReportCommand(program: Command) {
  program
    .command("report")
    .description("Generate a professional quality report for clients (Markdown or HTML)")
    .option("-o, --output <path>", "Output path for the report")
    .option("-f, --format <format>", "Output format: md or html", "md")
    .action(async (opts: { output?: string; format?: string }) => {
      const { runReport, printReportResult } = await import("../tools/report.js");
      const format = opts.format?.toLowerCase();
      if (format && format !== "md" && format !== "html") {
        console.error(chalk.red(`\n✖ Invalid format '${opts.format}'. Use 'md' or 'html'.`));
        process.exit(1);
      }
      try {
        const result = await runReport({
          outputPath: opts.output,
          format: format as "md" | "html" | undefined,
        });
        printReportResult(result);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
