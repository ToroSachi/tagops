import { Command } from "commander";
import chalk from "chalk";

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
    .action(async (name: string, opts: { pixelId?: string; measurementId?: string }) => {
      const { previewTemplate, printPreviewResult } = await import("../templates/registry.js");
      try {
        const result = previewTemplate(name, {
          pixelId: opts.pixelId,
          measurementId: opts.measurementId,
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
    });

  templates
    .command("install <name>")
    .description("Install an integration template into your GTM workspace")
    .option("--dry-run", "Preview what would be created without making changes")
    .option("--pixel-id <id>", "Pixel/tracking ID for the integration")
    .option("--measurement-id <id>", "GA4 Measurement ID")
    .action(
      async (
        name: string,
        opts: { dryRun?: boolean; pixelId?: string; measurementId?: string },
      ) => {
        const { installTemplate, printInstallResult } = await import("../templates/registry.js");
        try {
          const result = await installTemplate(name, {
            dryRun: opts.dryRun ?? false,
            pixelId: opts.pixelId,
            measurementId: opts.measurementId,
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
    .command("validate <name>")
    .description("Check if installed tags match a template definition (drift detection)")
    .option("--pixel-id <id>", "Pixel/tracking ID used when installing")
    .option("--measurement-id <id>", "GA4 Measurement ID")
    .action(async (name: string, opts: { pixelId?: string; measurementId?: string }) => {
      const { validateInstalledTags, printValidationResult } =
        await import("../templates/registry.js");
      const { listTags, listTriggers } = await import("../lib/gtm-cli.js");
      const { ALL_PAGES_TRIGGER_ID, TRIGGER_MAP, matchesCustomEventTrigger } =
        await import("../lib/architecture.js");

      try {
        const [tags, triggers] = await Promise.all([listTags(), listTriggers()]);
        const triggerEventById = new Map<string, string>();

        for (const trigger of triggers) {
          if (trigger.triggerId === ALL_PAGES_TRIGGER_ID) {
            triggerEventById.set(trigger.triggerId, "all_pages");
            continue;
          }

          for (const eventName of Object.keys(TRIGGER_MAP)) {
            if (matchesCustomEventTrigger(trigger, eventName)) {
              triggerEventById.set(trigger.triggerId, eventName);
              break;
            }
          }
        }

        const installedTags = tags.map((t: any) => {
          const htmlParam = t.parameter?.find((p: any) => p.key === "html");
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

        const result = validateInstalledTags(name, installedTags, {
          pixelId: opts.pixelId,
          measurementId: opts.measurementId,
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
    });
}
