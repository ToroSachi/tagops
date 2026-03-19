/**
 * Attach missing firing triggers to GTM tags.
 *
 * Usage:
 *   npx tsx src/cli.ts fix-triggers --mapping mapping.json
 */

import chalk from "chalk";
import { getTag, updateTag } from "../lib/gtm-cli.js";

export interface FixTriggersResult {
  tagId: string;
  name: string;
  triggerId: string;
  success: boolean;
  error?: string;
}

export async function fixTriggers(mapping: Record<string, string>): Promise<FixTriggersResult[]> {
  if (!mapping || Object.keys(mapping).length === 0) {
    throw new Error(
      "No tag-trigger mapping provided.\n" +
        'Use --mapping mapping.json with format: {"tagId": "triggerId", ...}',
    );
  }

  const results: FixTriggersResult[] = [];

  for (const [tagId, triggerIds] of Object.entries(mapping)) {
    console.log(`Updating tag ${tagId}...`);

    const tag = await getTag(tagId);
    if (!tag) {
      const result = {
        tagId,
        name: "?",
        triggerId: triggerIds,
        success: false,
        error: `Cannot get tag ${tagId}`,
      };
      results.push(result);
      console.log(`  ${chalk.red("✖")} Failed: ${result.error}`);
      continue;
    }

    const config: Record<string, unknown> = {
      type: tag.type,
      parameter: structuredClone(tag.parameter ?? []),
    };
    if (tag.consentSettings) {
      config.consentSettings = tag.consentSettings;
    }

    try {
      await updateTag({
        tagId,
        name: tag.name,
        fingerprint: tag.fingerprint,
        config,
        firingTriggerId: triggerIds,
      });
      results.push({ tagId, name: tag.name, triggerId: triggerIds, success: true });
      console.log(`  ${chalk.green("✔")} Tag ${tagId} (${tag.name}) → trigger(s) ${triggerIds}`);
    } catch (err) {
      const error = (err as Error).message;
      results.push({ tagId, name: tag.name, triggerId: triggerIds, success: false, error });
      console.log(`  ${chalk.red("✖")} Failed: ${error}`);
    }
  }

  return results;
}
