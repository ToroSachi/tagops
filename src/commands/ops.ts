import { Command } from "commander";
import chalk from "chalk";
import type { WebhookPayload } from "../tools/watch.js";

export function registerOpsCommands(program: Command) {
  program
    .command("status")
    .description("Quick health check — CLI, auth, config, resource counts")
    .action(async () => {
      const { checkStatus, printStatus } = await import("../tools/status.js");
      try {
        const report = await checkStatus();
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printStatus(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("doctor")
    .description("Run diagnostics on your tagops setup (Node, config, auth, API, consent)")
    .action(async () => {
      const { runDoctor, printDoctorReport } = await import("../tools/doctor.js");
      try {
        const report = await runDoctor();
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printDoctorReport(report);
        }
        if (report.failures > 0) process.exit(1);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("cleanup")
    .description(
      "Find and interactively delete unused variables, orphaned triggers, and paused tags",
    )
    .option("--scan-only", "Only print what would be deleted without prompting")
    .action(async (opts: { scanOnly?: boolean }) => {
      const { scanForCleanup, printCleanupReport, runInteractiveCleanup } =
        await import("../tools/cleanup.js");
      try {
        const report = await scanForCleanup();
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else if (opts.scanOnly) {
          printCleanupReport(report);
        } else {
          await runInteractiveCleanup(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("docgen")
    .description(
      "Generate a markdown data dictionary of all tags, triggers, variables, and data layer keys",
    )
    .option("--output <file>", "Output file path (default: gtm-dictionary.md)")
    .action(async (opts: { output?: string }) => {
      const { generateDocs, printDocgenResult } = await import("../tools/docgen.js");
      try {
        const result = await generateDocs(opts.output);
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printDocgenResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("graph")
    .description("Generate a visual dependency graph (Mermaid.js) of Tags, Triggers, and Variables")
    .option("--output <file>", "Output file path (default: gtm-graph.md)")
    .option("--snapshot <file>", "Generate graph from a saved snapshot instead of live workspace")
    .action(async (opts: { output?: string; snapshot?: string }) => {
      const { generateGraph, printGraphReport } = await import("../tools/graph.js");
      try {
        const report = await generateGraph({ output: opts.output, snapshot: opts.snapshot });
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printGraphReport(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
      }
    });

  program
    .command("init-ci")
    .description("Scaffold GitHub Actions workflows for GTM CI/CD (linting, diffs, deploys)")
    .action(async () => {
      const { initCi, printInitCiReport } = await import("../tools/init-ci.js");
      try {
        const report = initCi();
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printInitCiReport(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("backup")
    .description("Backup all workspace resources (tags, triggers, variables) to JSON")
    .option("--output-dir <dir>", "Output directory for backups")
    .action(async (opts: { outputDir?: string }) => {
      const { backupWorkspace } = await import("../tools/backup.js");
      try {
        if (!program.opts().json) console.log(chalk.bold("=== GTM Workspace Backup ===\n"));
        const result = await backupWorkspace(opts.outputDir);
        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          console.log(chalk.bold(`\n✅ Backup complete: ${result.backupDir}`));
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  program
    .command("ui")
    .description("Launch the local web dashboard (SaaS command center)")
    .option("-p, --port <number>", "Port to run the UI server on", "3000")
    .action(async (opts: { port: string }) => {
      const { launchUI } = await import("../tools/ui.js");
      await launchUI(Number(opts.port));
    });

  program
    .command("notify")
    .description("Send a notification to Slack or Microsoft Teams via webhook")
    .requiredOption("--webhook <url>", "Webhook URL (Slack or Teams)")
    .requiredOption(
      "--event <type>",
      "Event type: audit, consent_audit, publish, drift, snapshot, custom",
    )
    .requiredOption("--message <text>", "Notification summary message")
    .option("--score <number>", "Compliance score to include")
    .action(
      async (opts: {
        webhook: string;
        event: WebhookPayload["event"];
        message: string;
        score?: string;
      }) => {
        const { notifyEvent, printNotifyResult } = await import("../tools/watch.js");
        try {
          const result = await notifyEvent(
            opts.webhook,
            opts.event,
            opts.message,
            opts.score ? { score: parseInt(opts.score, 10) } : undefined,
          );
          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printNotifyResult(result);
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );

  program
    .command("watch")
    .description("Run a background daemon to monitor the GTM workspace for undocumented drift")
    .option("--interval <minutes>", "Polling interval in minutes", "5")
    .option("--webhook <url>", "Webhook URL to notify on drift")
    .action(async (opts: { interval: string; webhook?: string }) => {
      const { runWatchDaemon } = await import("../tools/watch.js");
      const interval = parseFloat(opts.interval);
      if (isNaN(interval) || interval <= 0) {
        console.error(
          chalk.red(`\n✖ Invalid interval: ${opts.interval}. Must be a positive number.`),
        );
        process.exit(1);
      }
      try {
        await runWatchDaemon(interval, opts.webhook);
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
