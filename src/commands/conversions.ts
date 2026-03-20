import { Command } from "commander";
import chalk from "chalk";

export function registerConversionCommands(program: Command) {
  program
    .command("enhanced-conversions")
    .description("Validate Google Ads enhanced conversion setup (2025 requirements)")
    .action(async () => {
      const { validateEnhancedConversions, printEnhancedConversionReport } =
        await import("../tools/enhanced-conversions.js");
      const { listTags } = await import("../lib/gtm-cli.js");
      try {
        const tags = await listTags();
        const report = validateEnhancedConversions(tags);
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printEnhancedConversionReport(report);
        }
        if (report.score < 50) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("sst-readiness")
    .description("Assess server-side tagging migration readiness")
    .action(async () => {
      const { assessSSTReadiness, printSSTReadinessReport } =
        await import("../tools/sst-readiness.js");
      const { getContainer, listClients, listTags, listTransformations, listVariables } =
        await import("../lib/gtm-cli.js");
      try {
        const container = await getContainer();
        const [tags, variables, clients, transformations] = await Promise.all([
          listTags(),
          listVariables(),
          container.features?.supportClients ? listClients() : Promise.resolve([]),
          container.features?.supportTransformations ? listTransformations() : Promise.resolve([]),
        ]);
        const report = assessSSTReadiness(tags, variables, {
          container,
          clients,
          transformations,
        });
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printSSTReadinessReport(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
