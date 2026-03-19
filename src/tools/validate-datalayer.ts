/**
 * Data Layer Validator — automated testing of dataLayer pushes on a live site.
 *
 * Navigates to specified URLs, captures all `dataLayer.push()` calls,
 * and validates them against expected event schemas defined in a config.
 *
 * Works without Playwright — uses a lightweight approach with Node's fetch
 * to validate that critical dataLayer variables exist in the page source,
 * or accepts a JSON file of captured dataLayer events for offline validation.
 *
 * Usage:
 *   npx tsx src/cli.ts validate-datalayer --url https://example.com --events page_view,view_item
 *   npx tsx src/cli.ts validate-datalayer --captured datalayer-dump.json
 */

import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Data Layer event schemas ──

export interface DataLayerEventSchema {
  event: string;
  requiredKeys: string[];
  optionalKeys?: string[];
}

export const STANDARD_SCHEMAS: DataLayerEventSchema[] = [
  {
    event: "page_view",
    requiredKeys: ["event"],
    optionalKeys: ["page_title", "page_location", "page_path"],
  },
  {
    event: "view_item",
    requiredKeys: ["event", "ecommerce"],
    optionalKeys: ["ecommerce.items", "ecommerce.value", "ecommerce.currency"],
  },
  {
    event: "add_to_cart",
    requiredKeys: ["event", "ecommerce"],
    optionalKeys: ["ecommerce.items", "ecommerce.value", "ecommerce.currency"],
  },
  {
    event: "remove_from_cart",
    requiredKeys: ["event", "ecommerce"],
    optionalKeys: ["ecommerce.items"],
  },
  {
    event: "begin_checkout",
    requiredKeys: ["event", "ecommerce"],
    optionalKeys: ["ecommerce.items", "ecommerce.value", "ecommerce.currency"],
  },
  {
    event: "purchase",
    requiredKeys: ["event", "ecommerce"],
    optionalKeys: [
      "ecommerce.transaction_id",
      "ecommerce.value",
      "ecommerce.currency",
      "ecommerce.items",
      "ecommerce.tax",
      "ecommerce.shipping",
    ],
  },
  {
    event: "ce_page_view",
    requiredKeys: ["event"],
  },
  {
    event: "user_data",
    requiredKeys: ["event"],
  },
  {
    event: "view_item_list",
    requiredKeys: ["event", "ecommerce"],
    optionalKeys: ["ecommerce.items"],
  },
  {
    event: "select_item",
    requiredKeys: ["event", "ecommerce"],
    optionalKeys: ["ecommerce.items"],
  },
];

// ── Validation types ──

export interface ValidationIssue {
  event: string;
  type: "missing_event" | "missing_key" | "empty_value" | "wrong_type";
  key?: string;
  message: string;
}

export interface DataLayerEvent {
  event?: string;
  [key: string]: unknown;
}

export interface ValidationResult {
  source: string;
  eventsChecked: number;
  eventsFound: number;
  issues: ValidationIssue[];
  passed: boolean;
  details: Array<{
    event: string;
    status: "pass" | "fail" | "not_found";
    issues: ValidationIssue[];
  }>;
}

/**
 * Deep-get a nested key from an object using dot notation.
 */
function deepGet(obj: Record<string, unknown>, path: string): unknown {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current == null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

/**
 * Validate a set of captured dataLayer events against standard or custom schemas.
 */
export function validateDataLayer(
  events: DataLayerEvent[],
  schemas?: DataLayerEventSchema[],
): ValidationResult {
  const activeSchemas = schemas ?? STANDARD_SCHEMAS;
  const issues: ValidationIssue[] = [];
  const details: ValidationResult["details"] = [];

  for (const schema of activeSchemas) {
    const matching = events.filter((e) => e.event === schema.event);

    if (matching.length === 0) {
      const issue: ValidationIssue = {
        event: schema.event,
        type: "missing_event",
        message: `Event "${schema.event}" not found in captured dataLayer events`,
      };
      issues.push(issue);
      details.push({ event: schema.event, status: "not_found", issues: [issue] });
      continue;
    }

    // Validate the first occurrence
    const eventData = matching[0];
    const eventIssues: ValidationIssue[] = [];

    for (const key of schema.requiredKeys) {
      if (key === "event") continue; // Already matched
      const value = deepGet(eventData as Record<string, unknown>, key);
      if (value === undefined) {
        eventIssues.push({
          event: schema.event,
          type: "missing_key",
          key,
          message: `Required key "${key}" is missing from "${schema.event}" event`,
        });
      } else if (value === null || value === "") {
        eventIssues.push({
          event: schema.event,
          type: "empty_value",
          key,
          message: `Key "${key}" is empty/null in "${schema.event}" event`,
        });
      }
    }

    issues.push(...eventIssues);
    details.push({
      event: schema.event,
      status: eventIssues.length > 0 ? "fail" : "pass",
      issues: eventIssues,
    });
  }

  return {
    source: "captured events",
    eventsChecked: activeSchemas.length,
    eventsFound: events.length,
    issues,
    passed: issues.length === 0,
    details,
  };
}

/**
 * Validate from a captured JSON file of dataLayer events.
 */
export function validateFromFile(
  filePath: string,
  schemas?: DataLayerEventSchema[],
): ValidationResult {
  const fullPath = resolve(filePath);
  if (!existsSync(fullPath)) {
    throw new Error(`File not found: ${fullPath}`);
  }

  const events = JSON.parse(readFileSync(fullPath, "utf-8")) as DataLayerEvent[];
  if (!Array.isArray(events)) {
    throw new Error("File must contain a JSON array of dataLayer events");
  }

  const result = validateDataLayer(events, schemas);
  result.source = filePath;
  return result;
}

/**
 * Generate a sample dataLayer capture script for use in browser console or Playwright.
 */
export function generateCaptureScript(): string {
  return `// Paste this into your browser console, navigate through your site,
// then run: copy(JSON.stringify(window.__dlCapture, null, 2))
// Save the output as datalayer-capture.json

(function() {
  window.__dlCapture = [];
  var origPush = window.dataLayer.push;
  window.dataLayer.push = function() {
    var args = Array.prototype.slice.call(arguments);
    for (var i = 0; i < args.length; i++) {
      window.__dlCapture.push(JSON.parse(JSON.stringify(args[i])));
    }
    return origPush.apply(window.dataLayer, args);
  };
  console.log('✅ dataLayer capture started. Navigate your site, then run:');
  console.log('   copy(JSON.stringify(window.__dlCapture, null, 2))');
})();`;
}

export function printValidationResult(result: ValidationResult): void {
  console.log(chalk.bold("\n  Data Layer Validation\n"));
  console.log(`  Source: ${chalk.gray(result.source)}`);
  console.log(`  Events checked: ${result.eventsChecked}`);
  console.log(`  Events captured: ${result.eventsFound}\n`);

  for (const detail of result.details) {
    const icon =
      detail.status === "pass"
        ? chalk.green("✔")
        : detail.status === "not_found"
          ? chalk.yellow("⚠")
          : chalk.red("✖");
    console.log(`  ${icon} ${detail.event} — ${detail.status.toUpperCase()}`);
    for (const issue of detail.issues) {
      console.log(chalk.gray(`      ${issue.message}`));
    }
  }

  console.log();
  if (result.passed) {
    console.log(chalk.green.bold("  ✅ All validations passed!\n"));
  } else {
    console.log(chalk.red.bold(`  ❌ ${result.issues.length} issue(s) found.\n`));
  }
}
