import { Command } from "commander";
import chalk from "chalk";

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
    .command("init-ci")
    .description("Scaffold GitHub Actions workflows for GTM CI/CD (linting, diffs, deploys)")
    .option("--branch <name>", "Target branch for pull requests and deploys", "main")
    .action(async (opts: { branch?: string }) => {
      const { initCi, printInitCiReport } = await import("../tools/init-ci.js");
      try {
        const report = initCi({ branch: opts.branch });
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
    .command("drift <snapshot>")
    .description(
      "Compare a saved snapshot against the live workspace using semantic drift detection",
    )
    .action(async (snapshot: string) => {
      const { detectDrift, printDriftReport } = await import("../tools/drift.js");
      try {
        const report = await detectDrift(snapshot);
        if (program.opts().json) {
          console.log(JSON.stringify(report, null, 2));
        } else {
          printDriftReport(report);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
