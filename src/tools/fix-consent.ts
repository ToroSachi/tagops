/**
 * Update consent settings on GTM tags.
 *
 * Usage:
 *   npx tsx src/cli.ts fix-consent --tag-ids 6,115,116 [--consent-type ad_storage]
 */

import chalk from "chalk";
import { getTag, updateTag } from "../lib/gtm-cli.js";
import { buildConsentConfig } from "../lib/gtm-cli.js";
import { isLightweightPixel } from "../lib/architecture.js";
import { createPreFixBackup } from "../lib/pre-fix-backup.js";

const DEFAULT_CONSENT_TYPE = "ad_storage";

/** Consent signals that should NOT be applied to lightweight pixel tags */
const HEAVY_CONSENT_SIGNALS = ["ad_user_data", "ad_personalization"];

export interface FixConsentResult {
  tagId: string;
  name: string;
  success: boolean;
  error?: string;
}

export async function fixConsent(
  tagIds: string[],
  consentType: string = DEFAULT_CONSENT_TYPE,
): Promise<FixConsentResult[]> {
  if (!tagIds || tagIds.length === 0) {
    throw new Error(
      "No tag IDs provided. Use --tag-ids 6,115,116 to specify which tags to update.",
    );
  }

  const results: FixConsentResult[] = [];

  // Create backup before modifying anything
  await createPreFixBackup("fix-consent");

  for (const tagId of tagIds) {
    const id = tagId.trim();
    console.log(`Updating tag ${id}...`);

    const tag = await getTag(id);
    if (!tag) {
      const result = { tagId: id, name: "?", success: false, error: `Cannot get tag ${id}` };
      results.push(result);
      console.log(`  ${chalk.red("✖")} Failed: ${result.error}`);
      continue;
    }

    // Guard: warn if applying heavy consent to lightweight pixel
    const searchText = tag.name + " " + (tag.parameter?.find((p) => p.key === "html")?.value ?? "");
    if (isLightweightPixel(searchText) && HEAVY_CONSENT_SIGNALS.includes(consentType)) {
      console.log(
        `  ${chalk.yellow("⚠")} Warning: "${tag.name}" is a lightweight pixel — ${consentType} may over-restrict it. Consider using ad_storage only.`,
      );
    }

    const config: Record<string, unknown> = {
      type: tag.type,
      parameter: structuredClone(tag.parameter ?? []),
      consentSettings: buildConsentConfig(consentType),
    };

    const firing = tag.firingTriggerId ?? [];

    try {
      await updateTag({
        tagId: id,
        name: tag.name,
        fingerprint: tag.fingerprint,
        config,
        firingTriggerId: firing,
      });
      results.push({ tagId: id, name: tag.name, success: true });
      console.log(`  ${chalk.green("✔")} Tag ${id} (${tag.name}) → consent: ${consentType}`);
    } catch (err) {
      const error = (err as Error).message;
      results.push({ tagId: id, name: tag.name, success: false, error });
      console.log(`  ${chalk.red("✖")} Failed: ${error}`);
    }
  }

  return results;
}
