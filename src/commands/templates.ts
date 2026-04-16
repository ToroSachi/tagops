import { Command } from "commander";
import chalk from "chalk";
import type { GtmTag, GtmParameter } from "../types/gtm.js";

export function registerTemplateCommands(program: Command) {
  const templates = program
    .command("templates")
    .description("Manage pre-built integration templates");

  templates
    .command("list")
    .description("List available integration templates")
    .action(async () => {
      const { listTemplates, printTemplateList } = await import("../templates/registry.js");
      const list = listTemplates();
      if (program.opts().json) {
        console.log(JSON.stringify(list, null, 2));
      } else {
        printTemplateList(list);
      }
    });

  templates
    .command("preview <name>")
    .description("Preview all tags and HTML that a template would create")
    .option("--pixel-id <id>", "Pixel/tracking ID for the integration")
    .option("--measurement-id <id>", "GA4 Measurement ID")
    .option("--conversion-id <id>", "Google Ads Conversion ID (AW-...)")
    .action(
      async (
        name: string,
        opts: { pixelId?: string; measurementId?: string; conversionId?: string },
      ) => {
        const { previewTemplate, printPreviewResult } = await import("../templates/registry.js");
        try {
          const result = previewTemplate(name, {
            pixelId: opts.pixelId,
            measurementId: opts.measurementId,
            conversionId: opts.conversionId,
          });
          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printPreviewResult(result);
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );

  templates
    .command("install <name>")
    .description("Install an integration template into your GTM workspace")
    .option("--dry-run", "Preview what would be created without making changes")
    .option("--pixel-id <id>", "Pixel/tracking ID for the integration")
    .option("--measurement-id <id>", "GA4 Measurement ID")
    .option("--conversion-id <id>", "Google Ads Conversion ID (AW-...)")
    .action(
      async (
        name: string,
        opts: {
          dryRun?: boolean;
          pixelId?: string;
          measurementId?: string;
          conversionId?: string;
        },
      ) => {
        const { installTemplate, printInstallResult } = await import("../templates/registry.js");
        try {
          const result = await installTemplate(name, {
            dryRun: opts.dryRun ?? false,
            pixelId: opts.pixelId,
            measurementId: opts.measurementId,
            conversionId: opts.conversionId,
          });
          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printInstallResult(result);
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );

  templates
    .command("validate [name]")
    .description(
      "Check if installed tags match a template definition (drift detection). Pass --all to scan every known template.",
    )
    .option("--all", "Scan every known template and report on any that appear installed")
    .option("--pixel-id <id>", "Pixel/tracking ID used when installing")
    .option("--measurement-id <id>", "GA4 Measurement ID")
    .option("--conversion-id <id>", "Google Ads Conversion ID (AW-...)")
    .action(
      async (
        name: string | undefined,
        opts: {
          all?: boolean;
          pixelId?: string;
          measurementId?: string;
          conversionId?: string;
        },
      ) => {
        const {
          validateInstalledTags,
          printValidationResult,
          validateAllTemplates,
          printValidateAllResult,
        } = await import("../templates/registry.js");
        const { listTags, listTriggers } = await import("../lib/gtm-cli.js");
        const {
          ALL_PAGES_TRIGGER_ID,
          CONSENT_INITIALIZATION_TRIGGER_ID,
          INITIALIZATION_TRIGGER_ID,
          TRIGGER_MAP,
          matchesCustomEventTrigger,
        } = await import("../lib/architecture.js");

        if (!name && !opts.all) {
          console.error(
            chalk.red("\n✖ Specify a template name or pass --all to scan every known template.\n"),
          );
          process.exit(1);
        }

        try {
          const [tags, triggers] = await Promise.all([listTags(), listTriggers()]);
          const triggerEventById = new Map<string, string>();

          for (const trigger of triggers) {
            if (trigger.triggerId === ALL_PAGES_TRIGGER_ID) {
              triggerEventById.set(trigger.triggerId, "all_pages");
              continue;
            }

            if (trigger.triggerId === INITIALIZATION_TRIGGER_ID) {
              triggerEventById.set(trigger.triggerId, "initialization");
              continue;
            }

            if (trigger.triggerId === CONSENT_INITIALIZATION_TRIGGER_ID) {
              triggerEventById.set(trigger.triggerId, "consent_initialization");
              continue;
            }

            for (const eventName of Object.keys(TRIGGER_MAP)) {
              if (matchesCustomEventTrigger(trigger, eventName)) {
                triggerEventById.set(trigger.triggerId, eventName);
                break;
              }
            }
          }

          const installedTags = tags.map((t: GtmTag) => {
            const htmlParam = t.parameter?.find((p: GtmParameter) => p.key === "html");
            const consentType = t.consentSettings?.consentType?.list?.[0]?.value;
            return {
              name: t.name,
              type: t.type,
              html: htmlParam?.value,
              consentType,
              triggerEvent: t.firingTriggerId?.map(
                (triggerId: string) => triggerEventById.get(triggerId) ?? `trigger:${triggerId}`,
              ),
            };
          });

          if (opts.all) {
            const result = validateAllTemplates(installedTags, {
              pixelId: opts.pixelId,
              measurementId: opts.measurementId,
              conversionId: opts.conversionId,
            });
            if (program.opts().json) {
              console.log(JSON.stringify(result, null, 2));
            } else {
              printValidateAllResult(result);
            }
            if (result.overallStatus === "fail") process.exit(1);
            return;
          }

          const result = validateInstalledTags(name as string, installedTags, {
            pixelId: opts.pixelId,
            measurementId: opts.measurementId,
            conversionId: opts.conversionId,
          });

          if (program.opts().json) {
            console.log(JSON.stringify(result, null, 2));
          } else {
            printValidationResult(result);
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );

  templates
    .command("export <name>")
    .description("Export a hydrated template as a portable JSON manifest")
    .option("--pixel-id <id>", "Pixel/tracking ID for the integration")
    .option("--measurement-id <id>", "GA4 Measurement ID")
    .option("--conversion-id <id>", "Google Ads Conversion ID (AW-...)")
    .option("--output <file>", "Output file path (default: stdout)")
    .action(
      async (
        name: string,
        opts: {
          pixelId?: string;
          measurementId?: string;
          conversionId?: string;
          output?: string;
        },
      ) => {
        const { exportTemplate, printManifestSummary } = await import("../templates/manifest.js");
        try {
          const inputs: Record<string, string> = {};
          if (opts.pixelId) inputs.pixelId = opts.pixelId;
          if (opts.measurementId) inputs.measurementId = opts.measurementId;
          if (opts.conversionId) inputs.conversionId = opts.conversionId;

          const manifest = exportTemplate(name, inputs);

          if (opts.output) {
            const { writeFileSync } = await import("node:fs");
            writeFileSync(opts.output, JSON.stringify(manifest, null, 2) + "\n");
            console.log(chalk.green(`\n  ✔ Manifest saved to ${opts.output}\n`));
            printManifestSummary(manifest);
          } else if (program.opts().json) {
            console.log(JSON.stringify(manifest, null, 2));
          } else {
            // Default: print JSON to stdout for piping
            console.log(JSON.stringify(manifest, null, 2));
          }
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );

  templates
    .command("import <file>")
    .description("Install tags from a previously exported template manifest")
    .option("--dry-run", "Preview what would be created without making changes")
    .action(async (file: string, opts: { dryRun?: boolean }) => {
      const { loadManifest, printManifestSummary, printManifestValidationErrors } =
        await import("../templates/manifest.js");
      const { installTemplate, printInstallResult } = await import("../templates/registry.js");

      try {
        const validation = loadManifest(file);

        if (!validation.valid || !validation.manifest) {
          printManifestValidationErrors(validation);
          process.exit(1);
        }

        const manifest = validation.manifest;

        if (!opts.dryRun) {
          printManifestSummary(manifest);
        }

        // Re-install using the registry with the manifest's inputs
        const inputs: Record<string, string> = {};
        if (manifest.inputs.pixelId) inputs.pixelId = manifest.inputs.pixelId;
        if (manifest.inputs.measurementId) inputs.measurementId = manifest.inputs.measurementId;
        if (manifest.inputs.conversionId) inputs.conversionId = manifest.inputs.conversionId;

        const result = await installTemplate(manifest.templateId, {
          dryRun: opts.dryRun ?? false,
          ...inputs,
        });

        if (program.opts().json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          printInstallResult(result);
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });

  // ── Bundle subcommands ──

  const bundle = templates
    .command("bundle")
    .description("Create and install multi-template bundles");

  bundle
    .command("create")
    .description("Create a bundle from multiple templates")
    .requiredOption("--name <name>", "Bundle name")
    .option("--description <text>", "Bundle description")
    .requiredOption(
      "--template <entries...>",
      "Template entries in the format templateId:key=value (e.g. meta-pixel:pixelId=123)",
    )
    .option("--output <file>", "Output file path (default: <name>.bundle.json)")
    .action(
      async (opts: { name: string; description?: string; template: string[]; output?: string }) => {
        const { createBundle, printBundleSummary } = await import("../templates/bundle.js");
        const { writeFileSync } = await import("node:fs");

        try {
          // Parse template entries like "meta-pixel:pixelId=123456"
          const entries = opts.template.map((raw) => {
            const [templateId, ...inputParts] = raw.split(":");
            const inputs: Record<string, string> = {};
            for (const part of inputParts) {
              const [key, value] = part.split("=");
              if (key && value) {
                inputs[key] = value;
              }
            }
            return { templateId, inputs };
          });

          const bundle = createBundle({
            name: opts.name,
            description: opts.description,
            entries,
          });

          const outFile = opts.output ?? `${opts.name}.bundle.json`;
          writeFileSync(outFile, JSON.stringify(bundle, null, 2) + "\n");

          console.log(chalk.green(`\n  ✔ Bundle saved to ${outFile}`));
          printBundleSummary(bundle);
        } catch (err) {
          console.error(chalk.red(`\n✖ ${(err as Error).message}`));
          process.exit(1);
        }
      },
    );

  bundle
    .command("install <file>")
    .description("Install all templates from a bundle file")
    .option("--dry-run", "Preview what would be created without making changes")
    .action(async (file: string, opts: { dryRun?: boolean }) => {
      const { loadBundle, printBundleSummary, printBundleValidationErrors } =
        await import("../templates/bundle.js");
      const { installTemplate, printInstallResult } = await import("../templates/registry.js");

      try {
        const validation = loadBundle(file);

        if (!validation.valid || !validation.bundle) {
          printBundleValidationErrors(validation);
          process.exit(1);
        }

        const bundleData = validation.bundle;
        printBundleSummary(bundleData);

        const results = [];

        for (const template of bundleData.templates) {
          const inputs: Record<string, string> = {};
          if (template.inputs.pixelId) inputs.pixelId = template.inputs.pixelId;
          if (template.inputs.measurementId) inputs.measurementId = template.inputs.measurementId;
          if (template.inputs.conversionId) inputs.conversionId = template.inputs.conversionId;

          const result = await installTemplate(template.templateId, {
            dryRun: opts.dryRun ?? false,
            ...inputs,
          });

          results.push(result);

          if (!program.opts().json) {
            printInstallResult(result);
          }
        }

        if (program.opts().json) {
          console.log(JSON.stringify(results, null, 2));
        } else {
          const totalTags = results.reduce((s, r) => s + r.summary.tags, 0);
          const totalFailed = results.reduce((s, r) => s + r.summary.failed, 0);
          const prefix = opts.dryRun ? "[DRY RUN] " : "";
          console.log(
            chalk.bold(
              `\n  ${prefix}Bundle Complete: ${results.length} templates, ${totalTags} tags${totalFailed > 0 ? `, ${totalFailed} failed` : ""}\n`,
            ),
          );
        }
      } catch (err) {
        console.error(chalk.red(`\n✖ ${(err as Error).message}`));
        process.exit(1);
      }
    });
}
