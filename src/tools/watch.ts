/**
 * Webhook Watch — Slack/Teams notifications for GTM changes
 *
 * Sends structured notifications to Slack or Microsoft Teams
 * when changes are detected or actions are performed.
 *
 * Usage:
 *   tagops watch --webhook https://hooks.slack.com/services/...
 *   tagops notify --webhook <url> --event publish --message "v1.5 deployed"
 */

import chalk from "chalk";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";

// Helper to delay execution
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface WebhookPayload {
  event: "audit" | "consent_audit" | "publish" | "drift" | "snapshot" | "custom";
  timestamp: string;
  container?: string;
  score?: number;
  summary: string;
  details?: Record<string, unknown>;
}

export interface NotifyResult {
  sent: boolean;
  statusCode?: number;
  error?: string;
}

/**
 * Send a notification payload to a webhook URL.
 * Supports Slack and Microsoft Teams webhook formats.
 */
export async function sendWebhook(url: string, payload: WebhookPayload): Promise<NotifyResult> {
  // Detect webhook type and format accordingly
  const body = isSlackWebhook(url)
    ? formatSlackPayload(payload)
    : isTeamsWebhook(url)
      ? formatTeamsPayload(payload)
      : formatGenericPayload(payload);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      return { sent: false, statusCode: response.status, error: `HTTP ${response.status}` };
    }

    return { sent: true, statusCode: response.status };
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }
}

function isSlackWebhook(url: string): boolean {
  return url.includes("hooks.slack.com") || url.includes("slack.com/api");
}

function isTeamsWebhook(url: string): boolean {
  return url.includes("webhook.office.com") || url.includes("outlook.office.com");
}

/**
 * Format payload for Slack incoming webhook.
 */
function formatSlackPayload(payload: WebhookPayload): Record<string, unknown> {
  const emoji = getEventEmoji(payload.event);
  const color =
    payload.event === "consent_audit" && (payload.score ?? 100) < 100
      ? "#ff4444"
      : payload.event === "drift"
        ? "#ffaa00"
        : "#22cc44";

  return {
    text: `${emoji} GTM Auto: ${payload.summary}`,
    attachments: [
      {
        color,
        fields: [
          { title: "Event", value: payload.event, short: true },
          { title: "Container", value: payload.container ?? "default", short: true },
          ...(payload.score !== undefined
            ? [{ title: "Compliance Score", value: `${payload.score}%`, short: true }]
            : []),
          { title: "Time", value: payload.timestamp, short: true },
        ],
      },
    ],
  };
}

/**
 * Format payload for Microsoft Teams incoming webhook.
 */
function formatTeamsPayload(payload: WebhookPayload): Record<string, unknown> {
  const emoji = getEventEmoji(payload.event);

  return {
    "@type": "MessageCard",
    "@context": "http://schema.org/extensions",
    summary: `GTM Auto: ${payload.summary}`,
    themeColor:
      payload.event === "consent_audit" && (payload.score ?? 100) < 100 ? "FF4444" : "22CC44",
    title: `${emoji} GTM Auto — ${payload.event}`,
    sections: [
      {
        facts: [
          { name: "Summary", value: payload.summary },
          { name: "Container", value: payload.container ?? "default" },
          ...(payload.score !== undefined
            ? [{ name: "Compliance Score", value: `${payload.score}%` }]
            : []),
          { name: "Time", value: payload.timestamp },
        ],
      },
    ],
  };
}

/**
 * Generic webhook payload format.
 */
function formatGenericPayload(payload: WebhookPayload): Record<string, unknown> {
  return payload as unknown as Record<string, unknown>;
}

function getEventEmoji(event: string): string {
  switch (event) {
    case "publish":
      return "🚀";
    case "audit":
      return "🔍";
    case "consent_audit":
      return "🛡️";
    case "drift":
      return "🚨";
    case "snapshot":
      return "📸";
    default:
      return "📣";
  }
}

/**
 * Helper to create and send a notification for common events.
 */
export async function notifyEvent(
  webhookUrl: string,
  event: WebhookPayload["event"],
  summary: string,
  options?: { container?: string; score?: number; details?: Record<string, unknown> },
): Promise<NotifyResult> {
  return sendWebhook(webhookUrl, {
    event,
    timestamp: new Date().toISOString(),
    summary,
    ...options,
  });
}

/**
 * Print notification result to CLI.
 */
export function printNotifyResult(result: NotifyResult): void {
  if (result.sent) {
    console.log(chalk.green(`\n  ✔ Notification sent successfully (HTTP ${result.statusCode})\n`));
  } else {
    console.log(chalk.red(`\n  ✖ Failed to send notification: ${result.error}\n`));
  }
}

/**
 * Run a background daemon that polls the GTM workspace for changes.
 * Compares current state against a baseline hash and triggers a webhook if drift is detected.
 */
export async function runWatchDaemon(intervalMinutes: number, webhookUrl?: string): Promise<never> {
  console.log(chalk.bold(`\n👁️  Starting TagOps Watch Daemon`));
  console.log(chalk.cyan(`  Polling interval: ${intervalMinutes} minute(s)`));
  if (webhookUrl) {
    console.log(chalk.cyan(`  Webhooks enabled: Yes`));
  }
  console.log("");

  let baselineHash = await getWorkspaceHash();
  console.log(
    chalk.gray(
      `  [${new Date().toLocaleTimeString()}] Baseline established. Monitoring for drift...`,
    ),
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await delay(intervalMinutes * 60 * 1000);

    try {
      const currentHash = await getWorkspaceHash();

      if (currentHash !== baselineHash) {
        console.log(chalk.yellow(`\n  🚨 [${new Date().toLocaleTimeString()}] DRIFT DETECTED!`));
        console.log(chalk.yellow(`  The GTM workspace was modified outside of TagOps.`));

        if (webhookUrl) {
          await notifyEvent(webhookUrl, "drift", "Undocumented changes detected in GTM workspace.");
        }

        // Update baseline so we don't spam alerts for the same change
        baselineHash = currentHash;
        console.log(chalk.gray(`  Baseline updated to match new state.`));
      } else {
        // Optional debug logging
        if (process.env.DEBUG === "true") {
          console.log(chalk.dim(`  [${new Date().toLocaleTimeString()}] State unchanged.`));
        }
      }
    } catch (err) {
      console.error(
        chalk.red(
          `  [${new Date().toLocaleTimeString()}] Error polling GTM: ${(err as Error).message}`,
        ),
      );
    }
  }
}

/**
 * Fetches all resources and creates a simple deterministic hash representation.
 */
async function getWorkspaceHash(): Promise<string> {
  const [tags, triggers, variables] = await Promise.all([
    listTags(),
    listTriggers(),
    listVariables(),
  ]);

  // Strip volatile fields that might change without actual config changes (like fingerpints)
  // Or just rely on the full object since GTM generates new fingerprints on edit.
  // Actually, GTM updates the `fingerprint` and `path` whenever a resource is modified.
  // So taking the stringified array of all fingerprints is a very fast and accurate way to detect ANY change.
  const state = {
    t: tags.map((t) => t.fingerprint).sort(),
    tr: triggers.map((t) => t.fingerprint).sort(),
    v: variables.map((v) => v.fingerprint).sort(),
  };

  return JSON.stringify(state);
}
