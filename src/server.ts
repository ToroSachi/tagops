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
import { TRIGGER_MAP, VARIABLE_MAP, ACTION_TO_TRIGGER } from "./lib/architecture.js";
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
      const { listTags, listVariables } = await import("./lib/gtm-cli.js");
      const [tags, variables] = await Promise.all([listTags(), listVariables()]);
      const report = assessSSTReadiness(tags, variables);
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
      const results: PixelResult[] = [];

      for (const pixel of pixels) {
        const action = pixel.action.toLowerCase();
        let triggerId = ACTION_TO_TRIGGER[action] ?? TRIGGER_MAP.page_view.id;
        const tagName = `${vendor_name} – ${action.charAt(0).toUpperCase() + action.slice(1)}${
          pixel.page_filter ? ` (${pixel.page_filter})` : ""
        }`;

        // If there's a page filter, create a filtered trigger
        if (pixel.page_filter && !dry_run) {
          const trigName = `CE - Page View (${pixel.page_filter})`;
          const trigConfig = {
            customEventFilter: [
              {
                type: "EQUALS",
                parameter: [
                  { type: "TEMPLATE", key: "arg0", value: "{{_event}}" },
                  { type: "TEMPLATE", key: "arg1", value: "ce_page_view" },
                ],
              },
            ],
            filter: [
              {
                type: "CONTAINS",
                parameter: [
                  { type: "TEMPLATE", key: "arg0", value: "{{Page Path}}" },
                  { type: "TEMPLATE", key: "arg1", value: pixel.page_filter },
                ],
              },
            ],
          };
          const trigResult = await createTrigger(trigName, "CUSTOM_EVENT", trigConfig);
          if (trigResult?.triggerId) {
            triggerId = trigResult.triggerId;
          }
        }

        // Build the HTML
        let html: string;
        if (pixel.dynamic_values && Object.keys(pixel.dynamic_values).length > 0) {
          const params = Object.entries(pixel.dynamic_values)
            .map(([key, dlv]) => {
              const gtmVar = VARIABLE_MAP[dlv] ?? dlv;
              return `  var ${key} = {{${gtmVar}}} || "";`;
            })
            .join("\n");
          const urlParams = Object.keys(pixel.dynamic_values)
            .map((key) => `' + "&${key}=" + encodeURIComponent(${key}) + '`)
            .join("");
          html = `<script>\n(function() {\n${params}\n  var img = new Image(1,1);\n  img.src = 'https://arttrk.com/pixel/?ad_log=referer&action=${action}${urlParams}&pixid=${pixel_id}';\n})();\n</script>`;
        } else {
          const contentParam = pixel.content_id ? `&content_id=${pixel.content_id}` : "";
          html = `<img src="https://arttrk.com/pixel/?ad_log=referer&action=${action}${contentParam}&pixid=${pixel_id}" width="1" height="1" border="0" style="display:none">`;
        }

        if (dry_run) {
          results.push({ action: "DRY_RUN", tagName, triggerId, html });
        } else {
          const config = buildHtmlTagConfig(html, "ad_storage");
          const createResult = await createTag({
            name: tagName,
            type: "html",
            firingTriggerId: triggerId,
            config,
          });
          results.push({
            action: createResult ? "CREATED" : "ERROR",
            tagName,
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
