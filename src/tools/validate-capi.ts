/**
 * Server-Side CAPI Payload Validator
 *
 * Validates Meta Conversions API and TikTok Events API payloads offline.
 * Checks for SHA-256 hashing compliance, deduplication keys, and required fields.
 *
 * Usage:
 *   tagops validate-capi --platform meta --payload ./purchase-event.json
 */

import chalk from "chalk";
import { readFileSync, existsSync } from "node:fs";

export interface CapiValidationOptions {
  platform: "meta" | "tiktok";
  payload?: any;
  payloadPath?: string;
}

export interface CapiValidationError {
  path: string;
  message: string;
  severity: "error" | "warning";
}

export interface CapiValidationResult {
  passed: boolean;
  platform: string;
  eventCount: number;
  errors: CapiValidationError[];
}

/**
 * Validates if a string is a valid SHA-256 lowercase hex string.
 */
function isSha256(str: string): boolean {
  return /^[a-f0-9]{64}$/.test(str);
}

/**
 * Validate a Meta Conversions API payload
 */
function validateMetaCapi(payload: any): CapiValidationResult {
  const errors: CapiValidationError[] = [];

  if (!payload || !Array.isArray(payload.data)) {
    return {
      passed: false,
      platform: "meta",
      eventCount: 0,
      errors: [
        { path: "root", message: "Payload must contain a 'data' array.", severity: "error" },
      ],
    };
  }

  const events = payload.data;
  const currentTime = Math.floor(Date.now() / 1000);

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const basePath = `data[${i}]`;

    // 1. Required Top-Level Fields
    if (!event.event_name)
      errors.push({
        path: `${basePath}.event_name`,
        message: "Missing required field 'event_name'",
        severity: "error",
      });
    if (!event.event_time) {
      errors.push({
        path: `${basePath}.event_time`,
        message: "Missing required field 'event_time'",
        severity: "error",
      });
    } else {
      if (typeof event.event_time !== "number")
        errors.push({
          path: `${basePath}.event_time`,
          message: "'event_time' must be a Unix timestamp (number)",
          severity: "error",
        });
      else if (event.event_time > currentTime)
        errors.push({
          path: `${basePath}.event_time`,
          message: "'event_time' is in the future",
          severity: "error",
        });
      // Meta rejects events older than 7 days
      else if (currentTime - event.event_time > 7 * 24 * 60 * 60)
        errors.push({
          path: `${basePath}.event_time`,
          message: "'event_time' is older than 7 days (will be rejected)",
          severity: "error",
        });
    }
    if (!event.action_source)
      errors.push({
        path: `${basePath}.action_source`,
        message: "Missing required field 'action_source'",
        severity: "error",
      });

    // 2. User Data (PII + Hashing)
    if (!event.user_data) {
      errors.push({
        path: `${basePath}.user_data`,
        message:
          "Missing required 'user_data' object. Server-side tracking heavily relies on this for match rates.",
        severity: "error",
      });
    } else {
      const ud = event.user_data;
      const hashFields = ["em", "ph", "fn", "ln", "ge", "db", "ct", "st", "zp", "country"];
      let hasValidPii = false;

      for (const field of hashFields) {
        if (ud[field]) {
          const vals = Array.isArray(ud[field]) ? ud[field] : [ud[field]];
          for (let j = 0; j < vals.length; j++) {
            const val = vals[j];
            if (typeof val !== "string") {
              errors.push({
                path: `${basePath}.user_data.${field}[${j}]`,
                message: "Must be a string",
                severity: "error",
              });
              continue;
            }
            if (!isSha256(val)) {
              errors.push({
                path: `${basePath}.user_data.${field}[${j}]`,
                message: "Value is NOT normalized and SHA-256 hashed. Meta will reject this.",
                severity: "error",
              });
            } else {
              hasValidPii = true;
            }
          }
        }
      }

      if (!hasValidPii && !ud.client_ip_address && !ud.client_user_agent) {
        errors.push({
          path: `${basePath}.user_data`,
          message: "No hashed PII or IP/User-Agent provided. Match rate will be 0%.",
          severity: "error",
        });
      }
      if (!ud.client_ip_address)
        errors.push({
          path: `${basePath}.user_data.client_ip_address`,
          message: "Missing client IP. Highly recommended for match rate.",
          severity: "warning",
        });
      if (!ud.client_user_agent)
        errors.push({
          path: `${basePath}.user_data.client_user_agent`,
          message: "Missing user agent. Highly recommended for match rate.",
          severity: "warning",
        });
      if (!ud.fbp && !ud.fbc)
        errors.push({
          path: `${basePath}.user_data`,
          message: "Missing both fbp and fbc cookies. Browser tracking continuity broken.",
          severity: "warning",
        });
    }

    // 3. Deduplication
    if (!event.event_id) {
      errors.push({
        path: `${basePath}.event_id`,
        message: "Missing 'event_id'. Essential for deduplicating browser and server events.",
        severity: "error",
      });
    }

    // 4. Custom Data Constraints
    if (event.event_name?.toLowerCase() === "purchase") {
      if (!event.custom_data) {
        errors.push({
          path: `${basePath}.custom_data`,
          message: "'Purchase' events require 'custom_data' with value and currency",
          severity: "error",
        });
      } else {
        if (!event.custom_data.value)
          errors.push({
            path: `${basePath}.custom_data.value`,
            message: "Missing 'value'",
            severity: "error",
          });
        if (!event.custom_data.currency)
          errors.push({
            path: `${basePath}.custom_data.currency`,
            message: "Missing 'currency'",
            severity: "error",
          });
      }
    }
  }

  return {
    passed: errors.filter((e) => e.severity === "error").length === 0,
    platform: "meta",
    eventCount: events.length,
    errors,
  };
}

/**
 * Validate a TikTok Events API payload
 */
function validateTikTokCapi(payload: any): CapiValidationResult {
  const errors: CapiValidationError[] = [];

  if (!payload) {
    return {
      passed: false,
      platform: "tiktok",
      eventCount: 0,
      errors: [{ path: "root", message: "Payload is empty.", severity: "error" }],
    };
  }

  // TikTok API can sometimes receive single events, though standard is wrapping.
  const events = Array.isArray(payload) ? payload : [payload];

  for (let i = 0; i < events.length; i++) {
    const event = events[i];
    const basePath = Array.isArray(payload) ? `[${i}]` : "root";

    if (!event.event)
      errors.push({
        path: `${basePath}.event`,
        message: "Missing required field 'event'",
        severity: "error",
      });
    if (!event.event_time)
      errors.push({
        path: `${basePath}.event_time`,
        message: "Missing required field 'event_time'",
        severity: "error",
      });
    if (!event.event_id)
      errors.push({
        path: `${basePath}.event_id`,
        message: "Missing 'event_id' for deduplication",
        severity: "error",
      });

    if (!event.user) {
      errors.push({
        path: `${basePath}.user`,
        message: "Missing 'user' object.",
        severity: "error",
      });
    } else {
      const u = event.user;
      if (!u.ttclid && !u.ttp)
        errors.push({
          path: `${basePath}.user`,
          message: "Missing both ttclid (click ID) and ttp (cookie ID).",
          severity: "warning",
        });

      const hashFields = ["email", "phone_number"];
      for (const field of hashFields) {
        if (u[field]) {
          if (!isSha256(u[field])) {
            errors.push({
              path: `${basePath}.user.${field}`,
              message: "Value must be a SHA-256 hashed string.",
              severity: "error",
            });
          }
        }
      }
    }
  }

  return {
    passed: errors.filter((e) => e.severity === "error").length === 0,
    platform: "tiktok",
    eventCount: events.length,
    errors,
  };
}

/**
 * Main entry point
 */
export async function validateCapiPayload(
  opts: CapiValidationOptions,
): Promise<CapiValidationResult> {
  let payload = opts.payload;

  if (!payload && opts.payloadPath) {
    if (!existsSync(opts.payloadPath)) {
      throw new Error(`Payload file not found: ${opts.payloadPath}`);
    }
    payload = JSON.parse(readFileSync(opts.payloadPath, "utf-8"));
  }

  if (!payload) {
    throw new Error("Must provide payload or payloadPath.");
  }

  if (opts.platform === "meta") {
    return validateMetaCapi(payload);
  } else if (opts.platform === "tiktok") {
    return validateTikTokCapi(payload);
  } else {
    throw new Error(`Unsupported platform: ${opts.platform}`);
  }
}

/**
 * Print the results
 */
export function printCapiValidationReport(result: CapiValidationResult): void {
  console.log(chalk.bold("\n══════════════════════════════════════════════════"));
  console.log(chalk.bold(`  Server-Side CAPI Validation (${result.platform.toUpperCase()})`));
  console.log(chalk.bold("══════════════════════════════════════════════════\n"));

  console.log(`  Events Parsed: ${result.eventCount}`);

  if (result.errors.length === 0) {
    console.log(
      `\n  ${chalk.green("✔")} Payload is perfectly formatted and compliant with ${result.platform.toUpperCase()} API requirements.\n`,
    );
    return;
  }

  const errors = result.errors.filter((e) => e.severity === "error");
  const warnings = result.errors.filter((e) => e.severity === "warning");

  console.log(
    `\n  Status: ${result.passed ? chalk.yellow("Passed (with warnings)") : chalk.red("Failed")}`,
  );
  console.log(`  Issues: ${errors.length} errors, ${warnings.length} warnings\n`);

  for (const issue of result.errors) {
    const icon = issue.severity === "error" ? chalk.red("✖") : chalk.yellow("⚠");
    console.log(`  ${icon} [${chalk.cyan(issue.path)}] ${issue.message}`);
  }
  console.log();
}
