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
import { registerWorkspaceCommands } from "./commands/workspace.js";
import { registerAuditCommand, registerConsentAuditCommand } from "./commands/audit.js";
import { registerHealthCommand, registerReportCommand } from "./commands/health-score.js";
import { registerConversionCommands } from "./commands/conversions.js";
import { registerGovernanceCommands } from "./commands/governance.js";
import { registerMultiContainerCommands } from "./commands/multi-container.js";
import { registerOpsCommands } from "./commands/ops.js";
import { registerIaCCommands } from "./commands/iac.js";
import { registerDeployCommand } from "./commands/deploy.js";
import { registerLegacyCommands } from "./commands/legacy.js";
import { registerTemplateCommands } from "./commands/templates.js";
import { registerProfileCommand } from "./commands/profiles.js";

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

// Register all command modules
registerInitCommand(program);
registerAuthCommands(program);
registerWorkspaceCommands(program);
registerAuditCommand(program);
registerConsentAuditCommand(program);
registerHealthCommand(program);
registerReportCommand(program);
registerConversionCommands(program);
registerGovernanceCommands(program);
registerMultiContainerCommands(program);
registerOpsCommands(program);
registerIaCCommands(program);
registerDeployCommand(program);
registerLegacyCommands(program);
registerTemplateCommands(program);
registerProfileCommand(program);

(async () => {
  try {
    await program.parseAsync();
  } catch (err) {
    handleError(err);
  }
})();
