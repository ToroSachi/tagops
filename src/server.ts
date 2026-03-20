#!/usr/bin/env node
/**
 * GTM MCP Server — Model Context Protocol server for Google Tag Manager
 *
 * Provides AI-accessible tools for managing GTM tags, triggers, variables,
 * and performing automated pixel implementations from plain English requirements.
 *
 * All tools use the shared typed library — no duplicated CLI logic.
 *
 * Usage:
 *   npx tsx src/server.ts
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __sFilename = fileURLToPath(import.meta.url);
const __sDirname = dirname(__sFilename);
const pkg = JSON.parse(readFileSync(resolve(__sDirname, "../package.json"), "utf-8"));

import {
  listTags,
  getTag,
  listTriggers,
  listVariables,
  createTag,
  createTrigger,
  buildHtmlTagConfig,
} from "./lib/gtm-cli.js";
import {
  TRIGGER_MAP,
  VARIABLE_MAP,
  ACTION_TO_TRIGGER,
  ALL_PAGES_TRIGGER_ID as DEFAULT_ALL_PAGES_TRIGGER_ID,
  discoverTriggerByEvent,
} from "./lib/architecture.js";
import { loadConfig } from "./lib/config.js";
import { auditWorkspace } from "./tools/audit.js";
import type { GtmTag, GtmTrigger, PixelResult } from "./types/gtm.js";

// ──────────────────────────────────────────────
// MCP SERVER
// ──────────────────────────────────────────────

const IS_READ_ONLY = process.argv.includes("--read-only");
if (IS_READ_ONLY) {
  console.error("[tagops-server] Starting in READ-ONLY mode — all write operations are disabled.");
}

// Trusted pixel domains that are allowed through the HTML sanitizer
const TRUSTED_PIXEL_DOMAINS = [
  "google-analytics.com",
  "googletagmanager.com",
  "google.com",
  "facebook.net",
  "facebook.com",
  "connect.facebook.net",
  "snap.licdn.com",
  "linkedin.com",
  "analytics.tiktok.com",
  "tiktok.com",
  "arttrk.com",
  "www.googleadservices.com",
  "bat.bing.com",
  "s.pinimg.com",
  "ct.pinterest.com",
];

function isHtmlPayloadSafe(html: string): { safe: boolean; reason?: string } {
  const dangerousPatterns: Array<[RegExp, string]> = [
    [/document\.cookie/i, "document.cookie access"],
    [/eval\s*\(/i, "eval() call"],
    [/document\.write\s*\(/i, "document.write() call"],
    [/Function\s*\(/i, "Function() constructor"],
    [/setTimeout\s*\(\s*['"`]/i, "setTimeout with string argument"],
    [/setInterval\s*\(\s*['"`]/i, "setInterval with string argument"],
    [/\.constructor\s*\(/i, ".constructor() invocation"],
    [/\batob\s*\(/i, "atob() base64 decoding"],
    [/window\s*\[/i, "dynamic window property access"],
    [/import\s*\(/i, "dynamic import()"],
  ];

  for (const [pattern, reason] of dangerousPatterns) {
    if (pattern.test(html)) {
      return { safe: false, reason };
    }
  }

  // Check all external script sources are from trusted domains
  const srcMatches = html.matchAll(/src\s*=\s*['"]([^'"]+)['"]/gi);
  for (const m of srcMatches) {
    const url = m[1];
    try {
      const hostname = new URL(url).hostname;
      if (!TRUSTED_PIXEL_DOMAINS.some((d) => hostname === d || hostname.endsWith(`.${d}`))) {
        return { safe: false, reason: `untrusted external domain: ${hostname}` };
      }
    } catch {
      // Not a valid URL (e.g. GTM variable), allow it
    }
  }

  return { safe: true };
}

const server = new McpServer({
  name: "tagops-server",
  version: pkg.version,
});

// ═══════════ RESOURCES ═══════════

server.resource("gtm-architecture", "gtm://architecture", async () => ({
  contents: [
    {
      uri: "gtm://architecture",
      mimeType: "application/json",
      text: JSON.stringify(
        {
          triggerMap: TRIGGER_MAP,
          variableMap: VARIABLE_MAP,
          conventions: {
            variables: "DLV - ecommerce.items, CJS - Format Items, CONST - GA4 Measurement ID",
            triggers: "CE - purchase, PV - All Pages, Click - CTA Button",
            tags: "GA4 - Purchase Event, Meta – PageView (SPA), Artsai – Purchase",
          },
        },
        null,
        2,
      ),
    },
  ],
}));

// ═══════════ TOOLS ═══════════

// --- List tags ---
server.tool("gtm_list_tags", "List all GTM tags in the current workspace", {}, async () => {
  const tags = await listTags();
  if (tags.length === 0) {
    return { content: [{ type: "text", text: "ERROR: Could not list tags. Check GTM auth." }] };
  }
  const summary = tags.map((t: GtmTag) => ({
    id: t.tagId,
    name: t.name,
    type: t.type,
    triggers: t.firingTriggerId ?? [],
    paused: t.paused ?? false,
  }));
  return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
});

// --- Get tag details ---
server.tool(
  "gtm_get_tag",
  "Get full details of a specific GTM tag",
  { tag_id: z.string().describe("The numeric tag ID") },
  async ({ tag_id }) => {
    const tag = await getTag(tag_id);
    if (!tag) {
      return { content: [{ type: "text", text: `ERROR: Tag ${tag_id} not found` }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(tag, null, 2) }] };
  },
);

// --- List triggers ---
server.tool("gtm_list_triggers", "List all GTM triggers in the current workspace", {}, async () => {
  const triggers = await listTriggers();
  if (triggers.length === 0) {
    return { content: [{ type: "text", text: "ERROR: Could not list triggers. Check GTM auth." }] };
  }
  const summary = triggers.map((t: GtmTrigger) => ({
    id: t.triggerId,
    name: t.name,
    type: t.type,
  }));
  return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
});

// --- List variables ---
server.tool(
  "gtm_list_variables",
  "List all GTM variables in the current workspace",
  {},
  async () => {
    const vars = await listVariables();
    if (vars.length === 0) {
      return {
        content: [{ type: "text", text: "ERROR: Could not list variables. Check GTM auth." }],
      };
    }
    const summary = vars.map((v) => {
      const nameParam = v.parameter?.find((p) => p.key === "name");
      return {
        id: v.variableId,
        name: v.name,
        type: v.type,
        reads: nameParam?.value ?? null,
      };
    });
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  },
);

// --- Create Custom HTML tag ---
if (!IS_READ_ONLY) {
  server.tool(
    "gtm_create_html_tag",
    "Create a Custom HTML tag in GTM with specified trigger and consent settings",
    {
      name: z.string().describe("Tag name, e.g. 'Artsai – Purchase'"),
      html: z.string().describe("HTML content for the tag (script or img)"),
      trigger_id: z.string().describe("Firing trigger ID"),
      consent_type: z
        .string()
        .optional()
        .describe("Consent type: 'ad_storage' or 'analytics_storage'. Default: ad_storage"),
    },
    async ({ name, html, trigger_id, consent_type }) => {
      const check = isHtmlPayloadSafe(html);
      if (!check.safe) {
        return {
          content: [
            {
              type: "text",
              text: `ERROR: Security blocked — ${check.reason}. Custom HTML tags must use safe GTM variables or trusted vendor scripts.`,
            },
          ],
        };
      }
      const config = buildHtmlTagConfig(html, consent_type ?? "ad_storage");
      const result = await createTag({
        name,
        type: "html",
        firingTriggerId: trigger_id,
        config,
      });
      return { content: [{ type: "text", text: result || "Tag created successfully" }] };
    },
  );

  // --- Create trigger ---
  server.tool(
    "gtm_create_trigger",
    "Create a Custom Event trigger in GTM",
    {
      name: z.string().describe("Trigger name, e.g. 'CE - Page View (/history)'"),
      event_name: z.string().describe("The dataLayer event name to listen for"),
      page_path_filter: z
        .string()
        .optional()
        .describe("Optional: filter to only fire when Page Path contains this value"),
    },
    async ({ name, event_name, page_path_filter }) => {
      const config: Record<string, unknown> = {
        customEventFilter: [
          {
            type: "EQUALS",
            parameter: [
              { type: "TEMPLATE", key: "arg0", value: "{{_event}}" },
              { type: "TEMPLATE", key: "arg1", value: event_name },
            ],
          },
        ],
      };
      if (page_path_filter) {
        config.filter = [
          {
            type: "CONTAINS",
            parameter: [
              { type: "TEMPLATE", key: "arg0", value: "{{Page Path}}" },
              { type: "TEMPLATE", key: "arg1", value: page_path_filter },
            ],
          },
        ];
      }
      const trigger = await createTrigger(name, "CUSTOM_EVENT", config);
      return {
        content: [
          { type: "text", text: trigger ? JSON.stringify(trigger, null, 2) : "Trigger created" },
        ],
      };
    },
  );
}

// --- Audit workspace ---
server.tool(
  "gtm_audit",
  "Audit the GTM workspace for misconfigurations: missing triggers, wrong consent, orphaned triggers, paused tags",
  {},
  async () => {
    try {
      const report = await auditWorkspace();
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Consent Mode v2 audit ---
server.tool(
  "gtm_consent_audit",
  "Deep audit of Consent Mode v2 compliance. Checks all 4 consent signals (ad_storage, ad_user_data, ad_personalization, analytics_storage) across every tag. Returns a compliance score 0-100%.",
  {
    fix: z
      .boolean()
      .optional()
      .describe(
        "If true, auto-fix non-compliant tags by adding required consent signals (dry run)",
      ),
  },
  async ({ fix }) => {
    try {
      if (fix && IS_READ_ONLY)
        throw new Error("Server is running in --read-only mode. Auto-fix is disabled.");
      const { auditConsentV2, fixConsentV2 } = await import("./tools/consent-audit.js");
      if (fix) {
        const result = await fixConsentV2(true); // Always dry-run in MCP for safety
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      }
      const report = await auditConsentV2();
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Doctor diagnostics ---
server.tool(
  "gtm_doctor",
  "Run diagnostics on the tagops setup: Node.js version, config, auth, API connectivity, resource health, and consent compliance.",
  {},
  async () => {
    try {
      const { runDoctor } = await import("./tools/doctor.js");
      const report = await runDoctor();
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Health Score ---
server.tool(
  "gtm_health_score",
  "Calculate a composite container health score (0-100) with letter grade. Combines consent, naming, hygiene, custom HTML risk, triggers, duplicates, and size.",
  {},
  async () => {
    try {
      const { calculateHealthScore } = await import("./tools/health-score.js");
      const { listTags, listTriggers, listVariables } = await import("./lib/gtm-cli.js");
      const [tags, triggers, variables] = await Promise.all([
        listTags(),
        listTriggers(),
        listVariables(),
      ]);
      const report = calculateHealthScore(tags, triggers, variables);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Enhanced Conversions ---
server.tool(
  "gtm_enhanced_conversions",
  "Validate Google Ads enhanced conversion setup per 2025 requirements. Checks for user-provided data event tags, trigger alignment, and consent.",
  {},
  async () => {
    try {
      const { validateEnhancedConversions } = await import("./tools/enhanced-conversions.js");
      const { listTags } = await import("./lib/gtm-cli.js");
      const tags = await listTags();
      const report = validateEnhancedConversions(tags);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- SST Readiness ---
server.tool(
  "gtm_sst_readiness",
  "Assess server-side tagging migration readiness. Categorizes tags as ready/community/custom/blocker and scores data layer coverage.",
  {},
  async () => {
    try {
      const { assessSSTReadiness } = await import("./tools/sst-readiness.js");
      const { getContainer, listClients, listTags, listTransformations, listVariables } =
        await import("./lib/gtm-cli.js");
      const container = await getContainer();
      const [tags, variables, clients, transformations] = await Promise.all([
        listTags(),
        listVariables(),
        container.features?.supportClients ? listClients() : Promise.resolve([]),
        container.features?.supportTransformations ? listTransformations() : Promise.resolve([]),
      ]);
      const report = assessSSTReadiness(tags, variables, {
        container,
        clients,
        transformations,
      });
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Compare containers ---
server.tool(
  "gtm_compare_containers",
  "Compare two GTM containers side-by-side using named profiles. Shows differences in tags, triggers, and variables between source and target.",
  {
    source_profile: z.string().describe("Source profile name from .gtmrc.json"),
    target_profile: z.string().describe("Target profile name from .gtmrc.json"),
  },
  async ({ source_profile, target_profile }) => {
    try {
      const { compareContainers } = await import("./tools/compare.js");
      const report = await compareContainers(source_profile, target_profile);
      return { content: [{ type: "text", text: JSON.stringify(report, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Sync containers ---
if (!IS_READ_ONLY) {
  server.tool(
    "gtm_sync_containers",
    "Sync tags, triggers, and variables from a source profile to a target profile. Automatically maps trigger IDs to prevent broken references.",
    {
      source_profile: z.string().describe("Source profile name from .gtmrc.json"),
      target_profile: z.string().describe("Target profile name from .gtmrc.json"),
      dry_run: z.boolean().optional().describe("Preview changes without actually syncing"),
    },
    async ({ source_profile, target_profile, dry_run }) => {
      try {
        const { syncContainers } = await import("./tools/sync.js");
        const result = await syncContainers({
          source: source_profile,
          target: target_profile,
          dryRun: dry_run,
          force: true, // MCP always forces to bypass stdin prompt
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
      }
    },
  );
}

// --- Test Data Layer ---
server.tool(
  "gtm_test_datalayer",
  "Run a headless browser session to simulate user interaction and validate window.dataLayer pushes against a JSON schema.",
  {
    url: z.string().describe("Target URL to test"),
    schema_path: z.string().optional().describe("Path to JSON schema file to validate against"),
    event_name: z.string().optional().describe("Only validate pushes matching this event name"),
    click_selector: z
      .string()
      .optional()
      .describe("CSS selector to click before capturing data layer"),
  },
  async ({ url, schema_path, event_name, click_selector }) => {
    try {
      const { testDataLayer } = await import("./tools/test-datalayer.js");
      const result = await testDataLayer({
        url,
        schemaPath: schema_path,
        eventName: event_name,
        clickSelector: click_selector,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Validate CAPI ---
server.tool(
  "gtm_validate_capi",
  "Validate Meta Conversions API or TikTok Events API server-side payloads offline. Checks hashing, deduplication ids, and required formats.",
  {
    platform: z.enum(["meta", "tiktok"]).describe("Platform to validate against"),
    payload_path: z.string().describe("Path to the JSON payload file"),
  },
  async ({ platform, payload_path }) => {
    try {
      const { validateCapiPayload } = await import("./tools/validate-capi.js");
      const result = await validateCapiPayload({
        platform,
        payloadPath: payload_path,
      });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Send notification ---
server.tool(
  "gtm_notify",
  "Send a notification to a Slack or Teams webhook. Useful for alerting on audit results, drift, or deploys.",
  {
    webhook_url: z.string().describe("Slack or Teams incoming webhook URL"),
    event: z
      .enum(["audit", "consent_audit", "publish", "drift", "snapshot", "custom"])
      .describe("Event type"),
    summary: z.string().describe("Summary message for the notification"),
    score: z.number().optional().describe("Optional compliance score to include"),
  },
  async ({ webhook_url, event, summary, score }) => {
    try {
      const { notifyEvent } = await import("./tools/watch.js");
      const result = await notifyEvent(
        webhook_url,
        event,
        summary,
        score !== undefined ? { score } : undefined,
      );
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Get architecture reference ---
server.tool(
  "gtm_get_architecture",
  "Get the GTM architecture reference: trigger IDs, variable names, and naming conventions",
  {},
  async () => ({
    content: [
      {
        type: "text",
        text: JSON.stringify({ triggerMap: TRIGGER_MAP, variableMap: VARIABLE_MAP }, null, 2),
      },
    ],
  }),
);

// --- Implement pixel from requirements ---
interface PixelRequest {
  action: string;
  page_filter?: string;
  dynamic_values?: Record<string, string>;
  content_id?: string;
}

interface TemplatePreviewTag {
  name: string;
  type: string;
  triggerEvent: string;
  consentType?: string;
  html: string;
}

interface PixelTagPlan {
  name: string;
  html: string;
  triggerEvent: string;
  consentType?: string;
  pageFilter?: string;
  source: "template" | "generic";
}

function normalizeComparableText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatActionLabel(action: string): string {
  return action
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getActionKeywords(action: string): string[] {
  switch (action) {
    case "purchase":
      return ["purchase"];
    case "signup":
      return ["signup", "sign up"];
    case "registration":
      return ["registration", "register"];
    case "lead":
      return ["lead"];
    case "content":
      return ["content", "view content"];
    case "pageview":
    case "page_view":
      return ["pageview", "page view", "page visit"];
    case "view_item":
      return ["view item", "view content", "content"];
    case "add_to_cart":
      return ["add to cart", "addtocart"];
    case "checkout":
    case "begin_checkout":
      return ["checkout", "begin checkout", "initiate checkout", "start checkout"];
    default:
      return [action.replace(/_/g, " ")];
  }
}

function isRenderableTemplateTag(tag: TemplatePreviewTag): boolean {
  return tag.type === "html" && tag.html.trim().length > 0;
}

function isBootstrapTemplateTag(tag: TemplatePreviewTag): boolean {
  if (!isRenderableTemplateTag(tag)) {
    return false;
  }

  if (tag.triggerEvent === "all_pages") {
    return true;
  }

  if (tag.triggerEvent !== "page_view") {
    return false;
  }

  const name = tag.name.toLowerCase();
  const bootstrapNamePattern =
    /\b(base|loader|global|tracking|universal|page ?view|page ?visit|base script)\b/;
  const bootstrapHtmlPattern =
    /document\.createElement\(['"]script['"]\)|appendChild\(|insertBefore\(|\.src\s*=\s*['"]https?:\/\/|\.init\(|fbq\('init'|ttq\.load\(|pintrk\('load'|rdt\('init'|MAI\.init|geq\.load\(|window\.__/i;

  return bootstrapNamePattern.test(name) || bootstrapHtmlPattern.test(tag.html);
}

function scoreTemplateTagForAction(tag: TemplatePreviewTag, action: string): number {
  const haystack = normalizeComparableText(`${tag.name} ${tag.html}`);
  return getActionKeywords(action).reduce((score, keyword) => {
    return score + (haystack.includes(normalizeComparableText(keyword)) ? 10 : 0);
  }, 0);
}

function selectTemplateTagForPixel(
  tags: TemplatePreviewTag[],
  pixel: PixelRequest,
  triggerEvent: string,
): TemplatePreviewTag | null {
  const candidates = tags.filter(
    (tag) => tag.triggerEvent === triggerEvent && isRenderableTemplateTag(tag),
  );

  if (candidates.length === 0) {
    return null;
  }

  const rankedCandidates = candidates
    .map((tag) => ({ tag, score: scoreTemplateTagForAction(tag, pixel.action.toLowerCase()) }))
    .sort((left, right) => right.score - left.score);

  if ((rankedCandidates[0]?.score ?? 0) > 0) {
    return rankedCandidates[0]?.tag ?? null;
  }

  if (triggerEvent === "page_view") {
    return candidates.find((tag) => isBootstrapTemplateTag(tag)) ?? null;
  }

  return candidates.length === 1 ? candidates[0] : null;
}

function buildGenericPixelScaffold(
  vendorName: string,
  pixelId: string,
  pixel: PixelRequest,
): string {
  const action = pixel.action.toLowerCase();
  const dynamicAssignments = Object.entries(pixel.dynamic_values ?? {})
    .map(([key, dataLayerKey]) => {
      const gtmVariable = VARIABLE_MAP[dataLayerKey] ?? dataLayerKey;
      return `  payload[${JSON.stringify(key)}] = {{${gtmVariable}}} || "";`;
    })
    .join("\n");

  const contentIdAssignment = pixel.content_id
    ? `  payload.content_id = ${JSON.stringify(pixel.content_id)};`
    : "";
  const pageFilterAssignment = pixel.page_filter
    ? `  payload.page_filter = ${JSON.stringify(pixel.page_filter)};`
    : "";

  return [
    "<script>",
    "(function() {",
    "  var payload = {",
    `    vendor: ${JSON.stringify(vendorName)},`,
    `    pixel_id: ${JSON.stringify(pixelId)},`,
    `    action: ${JSON.stringify(action)}`,
    "  };",
    contentIdAssignment,
    pageFilterAssignment,
    dynamicAssignments,
    "  window.tagopsPixelQueue = window.tagopsPixelQueue || [];",
    "  window.tagopsPixelQueue.push(payload);",
    '  if (window.console && typeof window.console.info === "function") {',
    '    window.console.info("Replace this scaffold with the vendor\'s official pixel code or install a matching TagOps template.", payload);',
    "  }",
    "})();",
    "</script>",
  ]
    .filter(Boolean)
    .join("\n");
}

function getTriggerLabel(triggerEvent: string): string {
  return triggerEvent === "all_pages"
    ? "All Pages"
    : (TRIGGER_MAP[triggerEvent]?.name ?? triggerEvent);
}

async function resolveTriggerForPlan(
  triggerEvent: string,
  pageFilter: string | undefined,
  dryRun: boolean | undefined,
): Promise<string> {
  if (!pageFilter || triggerEvent === "all_pages") {
    if (dryRun) {
      return pageFilter ? `${triggerEvent} (${pageFilter})` : triggerEvent;
    }

    if (triggerEvent === "all_pages") {
      return DEFAULT_ALL_PAGES_TRIGGER_ID;
    }

    return (await discoverTriggerByEvent(triggerEvent)) ?? "";
  }

  if (dryRun) {
    return `${triggerEvent} (${pageFilter})`;
  }

  const triggerName = `${getTriggerLabel(triggerEvent)} (${pageFilter})`;
  const eventName = TRIGGER_MAP[triggerEvent]?.event ?? triggerEvent;
  const trigger = await createTrigger(triggerName, "CUSTOM_EVENT", {
    customEventFilter: [
      {
        type: "EQUALS",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{_event}}" },
          { type: "TEMPLATE", key: "arg1", value: eventName },
        ],
      },
    ],
    filter: [
      {
        type: "CONTAINS",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{Page Path}}" },
          { type: "TEMPLATE", key: "arg1", value: pageFilter },
        ],
      },
    ],
  });

  return trigger?.triggerId ?? "";
}

if (!IS_READ_ONLY) {
  server.tool(
    "gtm_implement_pixel",
    "Intelligently implement a tracking pixel from plain English requirements. Maps actions to existing triggers and creates properly configured tags.",
    {
      vendor_name: z.string().describe("Vendor name, e.g. 'Artsai', 'Magellan', 'Reddit'"),
      pixel_id: z.string().describe("The vendor's pixel/tracking ID"),
      pixels: z
        .array(
          z.object({
            action: z
              .string()
              .describe(
                "Action type: purchase, signup, lead, content, pageview, add_to_cart, checkout, view_item",
              ),
            page_filter: z
              .string()
              .optional()
              .describe("Optional URL path filter, e.g. '/history'"),
            dynamic_values: z
              .record(z.string())
              .optional()
              .describe(
                "Dynamic values to pass, e.g. {value: 'ecommerce.value', order_id: 'ecommerce.transaction_id'}",
              ),
            content_id: z.string().optional().describe("Content ID for content-type pixels"),
          }),
        )
        .describe("Array of pixel configurations to create"),
      dry_run: z
        .boolean()
        .optional()
        .describe("If true, returns what would be created without making changes"),
    },
    async ({ vendor_name, pixel_id, pixels, dry_run }) => {
      const { findTemplateIdByVendor, previewTemplate } = await import("./templates/registry.js");

      const results: PixelResult[] = [];
      const templateId = findTemplateIdByVendor(vendor_name);
      const templatePreview = templateId
        ? previewTemplate(templateId, { pixelId: pixel_id })
        : null;
      const requestedPlans: PixelTagPlan[] = [];
      const matchedTemplateBaseNames = new Set<string>();

      if (templatePreview) {
        for (const pixel of pixels) {
          const triggerEvent = ACTION_TO_TRIGGER[pixel.action.toLowerCase()] ?? "page_view";
          const matchedTag = selectTemplateTagForPixel(
            templatePreview.tags as TemplatePreviewTag[],
            pixel as PixelRequest,
            triggerEvent,
          );

          if (matchedTag) {
            requestedPlans.push({
              name: `${matchedTag.name}${pixel.page_filter ? ` (${pixel.page_filter})` : ""}`,
              html: matchedTag.html,
              triggerEvent: matchedTag.triggerEvent,
              consentType: matchedTag.consentType,
              pageFilter: pixel.page_filter,
              source: "template",
            });
            matchedTemplateBaseNames.add(matchedTag.name);
            continue;
          }

          requestedPlans.push({
            name: `${vendor_name} – ${formatActionLabel(pixel.action)}${
              pixel.page_filter ? ` (${pixel.page_filter})` : ""
            }`,
            html: buildGenericPixelScaffold(vendor_name, pixel_id, pixel as PixelRequest),
            triggerEvent,
            consentType: "ad_storage",
            pageFilter: pixel.page_filter,
            source: "generic",
          });
        }
      } else {
        for (const pixel of pixels) {
          const triggerEvent = ACTION_TO_TRIGGER[pixel.action.toLowerCase()] ?? "page_view";
          requestedPlans.push({
            name: `${vendor_name} – ${formatActionLabel(pixel.action)}${
              pixel.page_filter ? ` (${pixel.page_filter})` : ""
            }`,
            html: buildGenericPixelScaffold(vendor_name, pixel_id, pixel as PixelRequest),
            triggerEvent,
            consentType: "ad_storage",
            pageFilter: pixel.page_filter,
            source: "generic",
          });
        }
      }

      const bootstrapPlans: PixelTagPlan[] =
        templatePreview && matchedTemplateBaseNames.size > 0
          ? (templatePreview.tags as TemplatePreviewTag[])
              .filter(
                (tag) => isBootstrapTemplateTag(tag) && !matchedTemplateBaseNames.has(tag.name),
              )
              .map((tag) => ({
                name: tag.name,
                html: tag.html,
                triggerEvent: tag.triggerEvent,
                consentType: tag.consentType,
                source: "template" as const,
              }))
          : [];

      const plans = [...bootstrapPlans, ...requestedPlans];
      const seenPlanKeys = new Set<string>();

      for (const plan of plans) {
        const dedupeKey = `${plan.name}::${plan.triggerEvent}::${plan.pageFilter ?? ""}`;
        if (seenPlanKeys.has(dedupeKey)) {
          continue;
        }
        seenPlanKeys.add(dedupeKey);

        const triggerId = await resolveTriggerForPlan(plan.triggerEvent, plan.pageFilter, dry_run);

        if (!dry_run && !triggerId) {
          throw new Error(
            `Could not find a matching GTM trigger for "${getTriggerLabel(plan.triggerEvent)}". Create the trigger before installing this pixel.`,
          );
        }

        if (dry_run) {
          results.push({
            action: "DRY_RUN",
            tagName: plan.name,
            triggerId,
            html: plan.html,
            result:
              plan.source === "template"
                ? `template:${templateId ?? "matched"}`
                : "generic_custom_html_scaffold",
          });
        } else {
          const config = buildHtmlTagConfig(plan.html, plan.consentType ?? "ad_storage");
          const createResult = await createTag({
            name: plan.name,
            type: "html",
            firingTriggerId: triggerId,
            config,
          });
          results.push({
            action: createResult ? "CREATED" : "ERROR",
            tagName: plan.name,
            triggerId,
            result: createResult?.substring(0, 200),
          });
        }
      }

      return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
    },
  );
}

// --- List integration templates ---
server.tool(
  "gtm_list_templates",
  "List all available pre-built integration templates (Meta, TikTok, Shopify, Impact, etc.)",
  {},
  async () => {
    const { listTemplates } = await import("./templates/registry.js");
    const templates = listTemplates();
    const summary = templates.map((t) => ({
      id: t.id,
      name: t.name,
      vendor: t.vendor,
      category: t.category,
      description: t.description,
      requiredInputs: t.requiredInputs.map((i) => ({
        key: i.key,
        name: i.name,
        example: i.example,
      })),
    }));
    return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
  },
);

// --- Preview template ---
server.tool(
  "gtm_preview_template",
  "Preview the tags and HTML that a template would create, without installing anything",
  {
    template_id: z.string().describe("Template ID (e.g. 'meta-pixel', 'shopify-custom-pixel')"),
    pixel_id: z
      .string()
      .optional()
      .describe("Pixel/tracking ID (uses example value if not provided)"),
  },
  async ({ template_id, pixel_id }) => {
    const { previewTemplate } = await import("./templates/registry.js");
    try {
      const result = previewTemplate(template_id, { pixelId: pixel_id });
      return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Install template ---
if (!IS_READ_ONLY) {
  server.tool(
    "gtm_install_template",
    "Install an integration template into the GTM workspace. Creates all necessary tags, triggers, and variables.",
    {
      template_id: z.string().describe("Template ID (e.g. 'meta-pixel', 'shopify-custom-pixel')"),
      pixel_id: z.string().describe("Pixel/tracking ID for the integration"),
      dry_run: z
        .boolean()
        .optional()
        .describe("If true, preview what would be created without making changes"),
    },
    async ({ template_id, pixel_id, dry_run }) => {
      const { installTemplate } = await import("./templates/registry.js");
      try {
        const result = await installTemplate(template_id, {
          dryRun: dry_run ?? false,
          pixelId: pixel_id,
        });
        return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
      } catch (err) {
        return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
      }
    },
  );
}

// ──────────────────────────────────────────────
// START SERVER
// ──────────────────────────────────────────────
const transport = new StdioServerTransport();
await server.connect(transport);
