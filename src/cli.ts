#!/usr/bin/env node
/**
 * GTM CLI Automation — unified command-line interface.
 * Now modularized. Commands are loaded from ./commands/
 */

import { Command } from "commander";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { registerInitCommand } from "./commands/init.js";
import { registerAuthCommands } from "./commands/auth.js";
import { registerAuditCommand, registerConsentAuditCommand } from "./commands/audit.js";
import { registerReportCommand } from "./commands/health-score.js";
import { registerGovernanceCommands } from "./commands/governance.js";
import { registerMultiContainerCommands } from "./commands/multi-container.js";
import { registerOpsCommands } from "./commands/ops.js";
import { registerIaCCommands } from "./commands/iac.js";
import { registerTemplateCommands } from "./commands/templates.js";
import { registerProfileCommand } from "./commands/profiles.js";
import { runWithProfile } from "./lib/config.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const pkg = JSON.parse(readFileSync(resolve(__dirname, "../package.json"), "utf-8"));

const program = new Command();

program
  .name("tagops")
  .description("TagOps — Infrastructure-as-Code for Google Tag Manager")
  .version(pkg.version)
  .option("--json", "Output results as JSON (for scripting/piping)")
  .option("--profile <name>", "Use a named profile from .gtmrc.json (for multi-container setups)");

import { handleError } from "./lib/errors.js";

function getCliProfileName(argv: string[]): string | undefined {
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (arg === "--profile") {
      return argv[index + 1];
    }
    if (arg.startsWith("--profile=")) {
      return arg.slice("--profile=".length);
    }
  }

  return undefined;
}

// Register all command modules
registerInitCommand(program);
registerAuthCommands(program);
registerAuditCommand(program);
registerConsentAuditCommand(program);
registerReportCommand(program);
registerGovernanceCommands(program);
registerMultiContainerCommands(program);
registerOpsCommands(program);
registerIaCCommands(program);
registerTemplateCommands(program);
registerProfileCommand(program);

(async () => {
  const profileName = getCliProfileName(process.argv.slice(2));

  try {
    await runWithProfile(profileName, async () => program.parseAsync());
  } catch (err) {
    handleError(err);
  }
})();
