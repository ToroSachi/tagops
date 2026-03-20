/**
 * Create Custom HTML pixel tags in GTM from a JSON config file.
 *
 * Usage:
 *   npx tsx src/cli.ts create-pixel --config pixels.json
 *
 * Config format:
 *   [{ "name": "...", "html": "...", "trigger_id": "...", "consent_type": "ad_storage" }, ...]
 */

import { readFileSync } from "node:fs";
import chalk from "chalk";
import { createTag, buildHtmlTagConfig } from "../lib/gtm-cli.js";
import { requireWriteAccess } from "../lib/permission-guard.js";

export interface PixelTagInput {
  name: string;
  html: string;
  trigger_id: string;
  consent_type?: string;
}

export interface CreatePixelResult {
  name: string;
  success: boolean;
  error?: string;
}

export async function createPixelTags(pixels: PixelTagInput[]): Promise<CreatePixelResult[]> {
  if (pixels.length > 0) {
    await requireWriteAccess();
  }

  const results: CreatePixelResult[] = [];

  for (const pixel of pixels) {
    const config = buildHtmlTagConfig(pixel.html, pixel.consent_type);

    try {
      const result = await createTag({
        name: pixel.name,
        type: "html",
        firingTriggerId: pixel.trigger_id,
        config,
      });

      if (result) {
        results.push({ name: pixel.name, success: true });
        console.log(`  ${chalk.green("✔")} Created: ${pixel.name}`);
      } else {
        results.push({ name: pixel.name, success: false, error: "No output from CLI" });
        console.log(`  ${chalk.red("✖")} Failed: ${pixel.name}`);
      }
    } catch (err) {
      const error = (err as Error).message;
      results.push({ name: pixel.name, success: false, error });
      console.log(`  ${chalk.red("✖")} Failed: ${pixel.name} — ${error}`);
    }
  }

  return results;
}

// Allow direct execution
if (import.meta.url === `file://${process.argv[1]}`) {
  if (!process.argv.includes("--config")) {
    console.log("Usage: npx tsx src/tools/create-pixel.ts --config pixels.json");
    process.exit(1);
  }
  const configPath = process.argv[process.argv.indexOf("--config") + 1];
  const pixels = JSON.parse(readFileSync(configPath, "utf-8")) as PixelTagInput[];

  console.log(chalk.bold(`\n=== Creating ${pixels.length} Pixel Tag(s) ===\n`));
  createPixelTags(pixels)
    .then((results) => {
      const success = results.filter((r) => r.success).length;
      console.log(chalk.bold(`\n✅ Done. Created ${success}/${results.length} tag(s).`));
    })
    .catch((err) => {
      console.error(chalk.red(`\n✖ ${(err as Error).message}`));
      process.exit(1);
    });
}
