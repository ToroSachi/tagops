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

import { lookup as dnsLookupDefault } from "node:dns/promises";
import { isIP } from "node:net";
import chalk from "chalk";
import {
  captureWorkspaceSnapshot,
  compareSnapshots,
  filterDriftReport,
  hasDrift,
  summarizeDriftChanges,
  type DriftChangeSummary,
  type DriftReport,
} from "./drift.js";

// Helper to delay execution
const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export interface WatchOptions {
  managedOnly?: boolean;
}

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

/** Injectable DNS lookup for tests (hostname → first A/AAAA address). */
export type WebhookDnsLookup = (hostname: string) => Promise<string>;

const BLOCKED_HOSTNAMES = new Set(["localhost", "metadata.google.internal"]);

function normalizeHostname(hostname: string): string {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase();
}

function ipv4Octets(ip: string): number[] | null {
  const parts = ip.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => Number(part));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

/**
 * True for loopback, link-local, private, CGNAT, and unspecified addresses.
 * Covers IPv4-mapped IPv6 (::ffff:x.x.x.x).
 */
export function isBlockedWebhookAddress(ip: string): boolean {
  const normalized = normalizeHostname(ip);
  if (normalized.includes(":")) {
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
    if (mapped) {
      return isBlockedWebhookAddress(mapped[1]);
    }
    if (normalized === "::" || normalized === "::1") return true;
    // Unique-local fc00::/7 and link-local fe80::/10
    if (normalized.startsWith("fc") || normalized.startsWith("fd")) return true;
    if (/^fe[89ab]/i.test(normalized)) return true;
    return false;
  }

  const octets = ipv4Octets(normalized);
  if (!octets) return false;
  const [a, b] = octets;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local / cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  return false;
}

/**
 * Synchronous URL shape checks: scheme, no userinfo, refuse private IP literals
 * and well-known internal hostnames. Does not resolve DNS.
 */
export function validateWebhookUrl(urlString: string): URL {
  let url: URL;
  try {
    url = new URL(urlString);
  } catch {
    throw new Error("Webhook URL is not a valid URL.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Webhook URL must use http or https.");
  }

  if (url.username || url.password) {
    throw new Error("Webhook URL must not include credentials.");
  }

  const hostname = normalizeHostname(url.hostname);
  if (!hostname) {
    throw new Error("Webhook URL hostname is required.");
  }

  if (BLOCKED_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost")) {
    throw new Error(`Webhook URL host is blocked: ${hostname}`);
  }

  if (isIP(hostname) && isBlockedWebhookAddress(hostname)) {
    throw new Error(`Webhook URL resolves to a blocked address: ${hostname}`);
  }

  return url;
}

async function defaultWebhookDnsLookup(hostname: string): Promise<string> {
  const result = await dnsLookupDefault(hostname, { all: false });
  return typeof result === "string" ? result : result.address;
}

/**
 * Resolve the webhook hostname and refuse private / link-local answers.
 * Residual DNS TOCTOU remains between this check and fetch(); pinning the
 * resolved address would require a custom HTTP client, which we deliberately
 * do not introduce here.
 */
export async function validateWebhookUrlResolved(
  urlString: string,
  lookup: WebhookDnsLookup = defaultWebhookDnsLookup,
): Promise<URL> {
  const url = validateWebhookUrl(urlString);
  const hostname = normalizeHostname(url.hostname);

  if (isIP(hostname)) {
    return url;
  }

  let address: string;
  try {
    address = await lookup(hostname);
  } catch (err) {
    throw new Error(`Webhook URL DNS lookup failed: ${(err as Error).message}`);
  }

  if (!address || isBlockedWebhookAddress(address)) {
    throw new Error(
      `Webhook URL host resolves to a blocked address (${address || "empty"}): ${hostname}`,
    );
  }

  return url;
}

function stripWebhookUrlFromMessage(message: string, url: string): string {
  if (!url) return message;
  return message.split(url).join("[webhook-url]");
}

/**
 * Send a notification payload to a webhook URL.
 * Supports Slack and Microsoft Teams webhook formats.
 */
export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  options?: { lookup?: WebhookDnsLookup },
): Promise<NotifyResult> {
  try {
    await validateWebhookUrlResolved(url, options?.lookup);
  } catch (err) {
    return { sent: false, error: (err as Error).message };
  }

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
    return {
      sent: false,
      error: stripWebhookUrlFromMessage((err as Error).message, url),
    };
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
  const detailsText = formatWebhookDetails(payload.details);

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
          ...(detailsText ? [{ title: "Changes", value: detailsText, short: false }] : []),
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
  const detailsText = formatWebhookDetails(payload.details);

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
        ...(detailsText ? { text: detailsText.replace(/\n/g, "<br/>") } : {}),
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
 * Compares current state against a semantic baseline and triggers a webhook if drift is detected.
 */
export async function runWatchDaemon(
  intervalMinutes: number,
  webhookUrl?: string,
  options: WatchOptions = {},
): Promise<never> {
  console.log(chalk.bold(`\n👁️  Starting TagOps Watch Daemon`));
  console.log(chalk.cyan(`  Polling interval: ${intervalMinutes} minute(s)`));
  if (webhookUrl) {
    console.log(chalk.cyan(`  Webhooks enabled: Yes`));
  }
  if (options.managedOnly) {
    console.log(chalk.cyan(`  Managed-only alerts: Yes`));
  }
  console.log("");

  let baselineSnapshot = await captureWorkspaceSnapshot();
  console.log(
    chalk.gray(
      `  [${new Date().toLocaleTimeString()}] Baseline established. Monitoring for drift...`,
    ),
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await delay(intervalMinutes * 60 * 1000);

    try {
      const currentSnapshot = await captureWorkspaceSnapshot();
      const fullReport = compareSnapshots(baselineSnapshot, currentSnapshot, {
        snapshotFile: "live workspace baseline",
        snapshotTimestamp: baselineSnapshot.meta.timestamp,
      });
      const alertReport = options.managedOnly
        ? filterDriftReport(fullReport, "managed")
        : fullReport;

      if (hasDrift(fullReport)) {
        const changeSummaries = summarizeDriftChanges(alertReport);

        if (changeSummaries.length > 0) {
          console.log(chalk.yellow(`\n  🚨 [${new Date().toLocaleTimeString()}] DRIFT DETECTED!`));
          printDriftChangeSummaries(alertReport);

          if (webhookUrl) {
            await notifyEvent(webhookUrl, "drift", buildDriftSummary(alertReport), {
              details: buildDriftWebhookDetails(alertReport),
            });
          }
        } else if (options.managedOnly) {
          console.log(
            chalk.dim(
              `  [${new Date().toLocaleTimeString()}] Drift detected, but it only affected unmanaged resources.`,
            ),
          );
        }

        // Update baseline so we don't spam alerts for the same change
        baselineSnapshot = currentSnapshot;
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

function formatWebhookDetails(details?: Record<string, unknown>): string | undefined {
  const changes = details?.changes;
  if (!Array.isArray(changes) || changes.length === 0) return undefined;

  const lines = changes.slice(0, 5).map((change) => {
    if (!change || typeof change !== "object") return "- change";
    const entry = change as {
      type?: string;
      name?: string;
      classification?: string;
      changeType?: string;
      fields?: string[];
    };
    const fields =
      entry.changeType === "added"
        ? ": added in live workspace"
        : entry.changeType === "deleted"
          ? ": deleted from live workspace"
          : entry.fields && entry.fields.length > 0
            ? `: ${entry.fields.join(", ")}`
            : "";
    return `- [${entry.type ?? "resource"}] ${entry.name ?? "unknown"} (${entry.classification ?? "unknown"}, ${entry.changeType ?? "changed"})${fields}`;
  });

  if (changes.length > 5) {
    lines.push(`- +${changes.length - 5} more change(s)`);
  }

  return lines.join("\n");
}

function buildDriftSummary(report: DriftReport): string {
  const changes = summarizeDriftChanges(report);
  if (changes.length === 0) {
    return "Semantic drift detected in GTM workspace.";
  }

  const managed = changes.filter((entry) => entry.classification === "managed").length;
  const unmanaged = changes.filter((entry) => entry.classification === "unmanaged").length;
  return `Semantic drift detected in ${changes.length} resource(s) (${managed} managed, ${unmanaged} unmanaged).`;
}

function buildDriftWebhookDetails(report: DriftReport): Record<string, unknown> {
  const changes = summarizeDriftChanges(report).map((entry) => ({
    name: entry.name,
    type: entry.type,
    classification: entry.classification,
    changeType: entry.changeType,
    fields: entry.fields,
  }));

  return {
    summary: report.summary,
    changes,
    fieldDrift: report.driftedResources.map((entry) => ({
      name: entry.name,
      type: entry.type,
      classification: entry.classification,
      field: entry.field,
      oldValue: entry.oldValue,
      newValue: entry.newValue,
    })),
    deletedResources: report.deletedResources.map((entry) => ({
      name: entry.name,
      type: entry.type,
      classification: entry.classification,
    })),
  };
}

function printDriftChangeSummaries(report: DriftReport): void {
  const changes = summarizeDriftChanges(report);
  if (changes.length === 0) {
    console.log(
      chalk.dim(`  Drift was detected, but no alertable resources matched the current filter.`),
    );
    return;
  }

  for (const change of changes) {
    console.log(chalk.yellow(`  ${formatDriftChange(change)}`));
  }
}

function formatDriftChange(change: DriftChangeSummary): string {
  const fields =
    change.changeType === "deleted"
      ? "deleted"
      : change.changeType === "added"
        ? "added"
        : change.fields.length > 0
          ? `fields: ${change.fields.join(", ")}`
          : "added";
  return `[${change.type}] ${change.name} (${change.classification}, ${change.changeType}) - ${fields}`;
}
