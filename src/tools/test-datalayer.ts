/**
 * Data Layer E2E Tester
 *
 * Runs a headless browser session to simulate user interaction
 * and validates the resulting dataLayer pushes against a JSON schema.
 *
 * Usage:
 *   tagops test-datalayer --url https://example.com --schema ./purchase.schema.json
 */

import chalk from "chalk";
import puppeteer from "puppeteer";
import Ajv, { type ErrorObject } from "ajv";
import { readFileSync, existsSync } from "node:fs";

declare global {
  interface Window {
    dataLayer: any[];
  }
}

export interface DataLayerTestOptions {
  url: string;
  schemaPath?: string;
  schema?: Record<string, unknown>; // direct JSON schema object
  eventName?: string; // Optional event name to filter by
  clickSelector?: string; // Optional element to click to trigger an event
  delayMs?: number; // Time to wait after load/click
  debug?: boolean; // Run with UI visible for debugging (non-headless)
}

export interface SchemaValidationError {
  eventPath: string;
  message: string;
  params: Record<string, unknown>;
}

export interface DataLayerValidationResult {
  passed: boolean;
  totalPushes: number;
  matchedEvents: number;
  errors: SchemaValidationError[];
  dataLayerSnapshot: any[];
}

/**
 * Executes the E2E test against the target URL
 */
export async function testDataLayer(
  opts: DataLayerTestOptions,
): Promise<DataLayerValidationResult> {
  // 1. Prepare Schema Validator
  const ajv = new Ajv.default({ allErrors: true, strict: false });
  let validate: ReturnType<typeof ajv.compile> | null = null;

  if (opts.schema) {
    validate = ajv.compile(opts.schema);
  } else if (opts.schemaPath) {
    if (!existsSync(opts.schemaPath)) {
      throw new Error(`Schema file not found: ${opts.schemaPath}`);
    }
    const schemaContent = JSON.parse(readFileSync(opts.schemaPath, "utf-8"));
    validate = ajv.compile(schemaContent);
  }

  // 2. Setup Puppeteer
  const browser = await puppeteer.launch({
    headless: opts.debug ? false : true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  let dataLayerSnapshot: any[] = [];

  try {
    console.log(chalk.dim(`\nLaunching browser... Navigating to ${opts.url}`));
    const page = await browser.newPage();

    // Ensures we don't throw if window.dataLayer isn't there yet
    await page.evaluateOnNewDocument(() => {
      window.dataLayer = window.dataLayer || [];
    });

    await page.goto(opts.url, { waitUntil: "networkidle0", timeout: 30000 });

    if (opts.delayMs && !opts.clickSelector) {
      console.log(chalk.dim(`Waiting ${opts.delayMs}ms...`));
      await new Promise((r) => setTimeout(r, opts.delayMs));
    }

    if (opts.clickSelector) {
      console.log(chalk.dim(`Clicking selector: ${chalk.bold(opts.clickSelector)}`));
      await page.waitForSelector(opts.clickSelector, { timeout: 10000 });
      await page.click(opts.clickSelector);

      const waitTime = opts.delayMs || 2500;
      console.log(chalk.dim(`Waiting ${waitTime}ms for push after click...`));
      await new Promise((r) => setTimeout(r, waitTime));
    }

    // Extract the dataLayer
    dataLayerSnapshot = await page.evaluate(() => {
      return [...(window.dataLayer || [])];
    });
  } finally {
    if (!opts.debug) {
      await browser.close();
    }
  }

  // 3. Filter and Validate Data Layer Pushes
  const validationErrors: SchemaValidationError[] = [];
  let matchedEvents = 0;

  for (let i = 0; i < dataLayerSnapshot.length; i++) {
    const dlPush = dataLayerSnapshot[i];

    // Skip if it doesn't match the requested event
    if (opts.eventName && dlPush.event !== opts.eventName) {
      continue;
    }

    matchedEvents++;

    if (validate) {
      const valid = validate(dlPush);
      if (!valid && validate.errors) {
        for (const err of validate.errors) {
          validationErrors.push({
            eventPath: opts.eventName
              ? `${opts.eventName}[${matchedEvents - 1}]${err.instancePath}`
              : `dataLayer[${i}]${err.instancePath}`,
            message: err.message || "Unknown error",
            params: err.params,
          });
        }
      }
    }
  }

  const passed = matchedEvents > 0 && validationErrors.length === 0;

  return {
    passed,
    totalPushes: dataLayerSnapshot.length,
    matchedEvents,
    errors: validationErrors,
    dataLayerSnapshot,
  };
}

/**
 * Prints a formatted test output
 */
export function printDataLayerTestReport(
  result: DataLayerValidationResult,
  opts: DataLayerTestOptions,
): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(chalk.bold("  Data Layer E2E Test Results"));
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  console.log(`  Total pushes:   ${result.totalPushes}`);

  if (opts.eventName) {
    console.log(`  Matched events: ${result.matchedEvents} (${opts.eventName})`);
  } else {
    console.log(`  Eval pushes:    ${result.matchedEvents}`);
  }

  if (result.matchedEvents === 0) {
    console.log(`\n  ${chalk.yellow("⚠")} No matching data layer events found to validate.`);
    if (opts.eventName) console.log(chalk.dim(`    Did the page fire '${opts.eventName}'?`));
    return;
  }

  if (!opts.schema && !opts.schemaPath) {
    console.log(`\n  ${chalk.cyan("ℹ")} No JSON schema provided. Dumping data layer snapshot:\n`);
    console.log(JSON.stringify(result.dataLayerSnapshot, null, 2));
    return;
  }

  if (result.passed) {
    console.log(
      `\n  ${chalk.green("✔")} Schema validation passed! All events perfectly align with schema.\n`,
    );
  } else {
    console.log(
      `\n  ${chalk.red("✖")} Schema validation failed with ${result.errors.length} error(s):\n`,
    );

    for (const error of result.errors) {
      console.log(`    ${chalk.red("→")} ${chalk.bold(error.eventPath)}: ${error.message}`);
      if (Object.keys(error.params).length > 0) {
        console.log(`      ${chalk.dim(JSON.stringify(error.params))}`);
      }
    }
    console.log();
  }
}
