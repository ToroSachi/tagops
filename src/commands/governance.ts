import { Command } from "commander";
import chalk from "chalk";

export function registerGovernanceCommands(program: Command) {
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

  program
    .command("test-datalayer")
    .description(
      "Run a headless browser session to validate data layer pushes against a JSON schema",
    )
    .requiredOption("--url <url>", "Target URL to test")
    .option("--schema <path>", "Path to JSON schema file to validate against")
    .option("--event <name>", "Optional: only validate pushes matching this event name")
    .option("--click <selector>", "Optional: CSS selector to click before capturing data layer")
    .option(
      "--delay <ms>",
      "Optional: MS to wait after load/click (default: 2500 if click is used)",
    )
    .option("--debug", "Run visibly (non-headless) for debugging")
    .action(
      async (opts: {
        url: string;
        schema?: string;
        event?: string;
        click?: string;
        delay?: string;
        debug?: boolean;
      }) => {
        const { testDataLayer, printDataLayerTestReport } =
          await import("../tools/test-datalayer.js");
        try {
          const result = await testDataLayer({
            url: opts.url,
            schemaPath: opts.schema,
            eventName: opts.event,
            clickSelector: opts.click,
            delayMs: opts.delay ? parseInt(opts.delay, 10) : undefined,
            debug: !!opts.debug,
          });

          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printDataLayerTestReport(result, {
              url: opts.url,
              schemaPath: opts.schema,
              eventName: opts.event,
            });
          }
          if (!result.passed) process.exit(1);
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );

  program
    .command("validate-capi")
    .description("Validate Meta Conversions API or TikTok Events API server-side payloads offline")
    .requiredOption("--platform <name>", "Platform to validate against: meta or tiktok")
    .requiredOption("--payload <path>", "Path to JSON payload file")
    .action(async (opts: { platform: string; payload: string }) => {
      const { validateCapiPayload, printCapiValidationReport } =
        await import("../tools/validate-capi.js");
      try {
        const result = await validateCapiPayload({
          platform: opts.platform as "meta" | "tiktok",
          payloadPath: opts.payload,
        });

        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printCapiValidationReport(result);
        }
        if (!result.passed) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("validate-datalayer")
    .description("Validate dataLayer events against standard e-commerce schemas")
    .option("--captured <file>", "Path to a JSON file of captured dataLayer events")
    .option("--capture-script", "Print a browser console script to capture dataLayer events")
    .option("--events <list>", "Comma-separated list of events to validate (default: all standard)")
    .action(async (opts: { captured?: string; captureScript?: boolean; events?: string }) => {
      const { validateFromFile, generateCaptureScript, printValidationResult, STANDARD_SCHEMAS } =
        await import("../tools/validate-datalayer.js");
      try {
        if (opts.captureScript) {
          console.log(chalk.bold("\n  DataLayer Capture Script\n"));
          console.log(chalk.gray("  Paste this into your browser console:\n"));
          console.log(generateCaptureScript());
          console.log();
          return;
        }

        if (!opts.captured) {
          console.error(chalk.red("\n✖ Please provide a captured dataLayer file:"));
          console.log(
            chalk.cyan("    tagops validate-datalayer --captured datalayer-capture.json\n"),
          );
          console.log("  To capture events, first run:");
          console.log(chalk.cyan("    tagops validate-datalayer --capture-script\n"));
          process.exit(1);
        }

        let schemas = STANDARD_SCHEMAS;
        if (opts.events) {
          const eventList = opts.events.split(",").map((e) => e.trim());
          schemas = STANDARD_SCHEMAS.filter((s) => eventList.includes(s.event));
        }

        const result = validateFromFile(opts.captured, schemas);
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printValidationResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
