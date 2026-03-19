import { Command } from "commander";
import chalk from "chalk";
import { readFileSync } from "node:fs";
import type { PixelTagInput } from "../tools/create-pixel.js";

export function registerLegacyCommands(program: Command) {
  program
    .command("fix-consent")
    .description("Update consent settings on GTM tags")
    .option("--tag-ids <ids>", "Comma-separated tag IDs to update (required)")
    .option("--consent-type <type>", "Consent type to set (default: ad_storage)")
    .action(async (opts: { tagIds?: string; consentType?: string }) => {
      const { fixConsent } = await import("../tools/fix-consent.js");
      const tagIds = opts.tagIds?.split(",");
      if (!tagIds || tagIds.length === 0) {
        console.error(
          chalk.red("\n✖ --tag-ids is required. Example: tagops fix-consent --tag-ids 6,115,116\n"),
        );
        process.exit(1);
      }
      const consentType = opts.consentType ?? "ad_storage";
      if (!program.opts().json)
        console.log(chalk.bold(`\n=== Fixing Consent Settings → ${consentType} ===\n`));
      try {
        const results = await fixConsent(tagIds, opts.consentType);
        if (program.opts().json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          const success = results.filter((r) => r.success).length;
          console.log(chalk.bold(`\n✅ Done. Updated ${success}/${results.length} tag(s).`));
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("fix-triggers")
    .description("Attach missing firing triggers to GTM tags")
    .requiredOption("--mapping <file>", "JSON mapping file: {tagId: triggerId, ...}")
    .action(async (opts: { mapping: string }) => {
      const { fixTriggers } = await import("../tools/fix-triggers.js");
      if (!program.opts().json) console.log(chalk.bold("\n=== Fixing Missing Triggers ===\n"));
      try {
        const mapRaw = readFileSync(opts.mapping, "utf-8");
        const mapping = JSON.parse(mapRaw) as Record<string, string>;
        const results = await fixTriggers(mapping);
        if (program.opts().json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          const success = results.filter((r) => r.success).length;
          console.log(chalk.bold(`\n✅ Done. Updated ${success}/${results.length} tag(s).`));
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("fix-firing")
    .description("Detect and fix tags with unlimited firing (SPA duplicate risk)")
    .option("--dry-run", "Preview fixes without applying them")
    .option(
      "--option <value>",
      "Override firing option for ALL tags: oncePerEvent or oncePerLoad (default: auto-detect per tag)",
    )
    .action(async (opts: { dryRun?: boolean; option?: string }) => {
      const { fixFiring, printFixFiringReport } = await import("../tools/fix-firing.js");
      try {
        const result = await fixFiring(
          opts.option as "oncePerEvent" | "oncePerLoad" | undefined,
          !!opts.dryRun,
        );
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printFixFiringReport(result, !!opts.dryRun);
        }
        if (result.errors > 0) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("create-pixel")
    .description("Create Custom HTML pixel tags from a JSON config file")
    .requiredOption("--config <file>", "Path to JSON config file")
    .action(async (opts: { config: string }) => {
      const { createPixelTags } = await import("../tools/create-pixel.js");
      const pixels = JSON.parse(readFileSync(opts.config, "utf-8")) as PixelTagInput[];
      if (!program.opts().json)
        console.log(chalk.bold(`\n=== Creating ${pixels.length} Pixel Tag(s) ===\n`));
      const results = await createPixelTags(pixels);
      if (program.opts().json) {
        console.log(JSON.stringify(results, null, 2));
      } else {
        const success = results.filter((r) => r.success).length;
        console.log(chalk.bold(`\n✅ Done. Created ${success}/${results.length} tag(s).`));
      }
    });
}
