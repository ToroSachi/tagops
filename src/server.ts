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
  verifyGtmConnection,
} from "./lib/gtm-cli.js";
import {
  TRIGGER_MAP,
  VARIABLE_MAP,
  ACTION_TO_TRIGGER,
  ALL_PAGES_TRIGGER_ID as DEFAULT_ALL_PAGES_TRIGGER_ID,
  discoverTriggerByEvent,
} from "./lib/architecture.js";
import { runWithProfile } from "./lib/config.js";
import { requireWriteAccess } from "./lib/permission-guard.js";
import { auditWorkspace } from "./tools/audit.js";
import { plan } from "./tools/plan.js";
import { detectDrift } from "./tools/drift.js";
import { evaluatePolicies, loadPoliciesFromConfig } from "./lib/policies.js";
import { listVersionHistory, rollback } from "./tools/rollback.js";
import { promote } from "./tools/promote.js";
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

function asJsonContent(value: unknown) {
  return [{ type: "text" as const, text: JSON.stringify(value, null, 2) }];
}

function okResult<T extends object>(structuredContent: T) {
  const payload = structuredContent as unknown as Record<string, unknown>;
  return {
    content: asJsonContent(payload),
    structuredContent: payload,
  };
}

function errorResult(message: string) {
  return {
    content: asJsonContent({ error: message }),
    structuredContent: { error: message },
    isError: true,
  };
}

const toolErrorSchema = z.object({
  error: z.string().describe("Useful error message explaining why the tool call failed."),
});

const planActionSchema = z.object({
  action: z.enum(["create", "update", "delete"]),
  resourceType: z.enum(["tag", "trigger", "variable", "folder"]),
  id: z.string(),
  name: z.string(),
  changes: z.array(z.string()).optional(),
  detail: z.string().optional(),
});

const resourcePlanCountsSchema = z.object({
  current: z.number().int().nonnegative(),
  snapshot: z.number().int().nonnegative(),
  create: z.number().int().nonnegative(),
  update: z.number().int().nonnegative(),
  delete: z.number().int().nonnegative(),
  unchanged: z.number().int().nonnegative(),
});

const planResultSchema = z.object({
  snapshotFile: z.string(),
  snapshotTimestamp: z.string(),
  actions: z.array(planActionSchema),
  resourceCounts: z.object({
    tags: resourcePlanCountsSchema,
    triggers: resourcePlanCountsSchema,
    variables: resourcePlanCountsSchema,
    folders: resourcePlanCountsSchema,
    total: resourcePlanCountsSchema,
  }),
  safetyWarnings: z.array(z.string()),
  riskLevel: z.enum(["low", "medium", "high", "critical"]),
});

const driftResourceTypeSchema = z.enum(["tag", "trigger", "variable"]);
const driftClassificationSchema = z.enum(["managed", "unmanaged"]);

const driftedResourceSchema = z.object({
  name: z.string(),
  type: driftResourceTypeSchema,
  resourceType: driftResourceTypeSchema,
  field: z.string(),
  oldValue: z.any(),
  newValue: z.any(),
  classification: driftClassificationSchema,
  changeType: z.enum(["added", "modified"]),
  id: z.string().optional(),
  gtmType: z.string().optional(),
  tagOpsId: z.string().optional(),
});

const driftResourceSummarySchema = z.object({
  name: z.string(),
  type: driftResourceTypeSchema,
  resourceType: driftResourceTypeSchema,
  classification: driftClassificationSchema,
  changeType: z.enum(["added", "modified"]),
  fields: z.array(z.string()),
  id: z.string().optional(),
  gtmType: z.string().optional(),
  tagOpsId: z.string().optional(),
});

const deletedResourceSchema = z.object({
  name: z.string(),
  type: driftResourceTypeSchema,
  resourceType: driftResourceTypeSchema,
  classification: driftClassificationSchema,
  id: z.string().optional(),
  gtmType: z.string().optional(),
  tagOpsId: z.string().optional(),
});

const driftReportSchema = z.object({
  snapshotFile: z.string(),
  snapshotTimestamp: z.string(),
  driftedResources: z.array(driftedResourceSchema),
  unmanagedResources: z.array(driftResourceSummarySchema),
  deletedResources: z.array(deletedResourceSchema),
  summary: z.object({
    totalChanges: z.number().int().nonnegative(),
    driftedFields: z.number().int().nonnegative(),
    driftedResources: z.number().int().nonnegative(),
    unmanagedResources: z.number().int().nonnegative(),
    deletedResources: z.number().int().nonnegative(),
    managedChanges: z.number().int().nonnegative(),
    unmanagedChanges: z.number().int().nonnegative(),
  }),
});

const policyViolationSchema = z.object({
  policyId: z.string(),
  policyName: z.string(),
  severity: z.enum(["error", "warning", "info"]),
  category: z.enum(["consent", "firing", "naming", "security", "performance", "vendor"]),
  resourceType: z.enum(["tag", "trigger", "workspace"]),
  resourceId: z.string(),
  resourceName: z.string(),
  message: z.string(),
});

const policyReportSchema = z.object({
  timestamp: z.string(),
  enabledPolicies: z.array(z.string()),
  violations: z.array(policyViolationSchema),
  passed: z.boolean(),
  summary: z.object({
    errors: z.number().int().nonnegative(),
    warnings: z.number().int().nonnegative(),
    info: z.number().int().nonnegative(),
    total: z.number().int().nonnegative(),
  }),
  resources: z.object({
    tags: z.number().int().nonnegative(),
    triggers: z.number().int().nonnegative(),
    variables: z.number().int().nonnegative(),
  }),
});

const workspaceStatusSchema = z.object({
  synced: z.boolean(),
  mergeConflictCount: z.number().int().nonnegative(),
  pendingChangeCount: z.number().int().nonnegative(),
  mergeConflict: z.array(z.record(z.unknown())),
  workspaceChange: z.array(z.record(z.unknown())),
});

const workspaceSchema = z
  .object({
    workspaceId: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    path: z.string().optional(),
    fingerprint: z.string().optional(),
    tagManagerUrl: z.string().optional(),
  })
  .passthrough();

const workspaceCreateResultSchema = z.object({
  created: z.literal(true),
  workspaceId: z.string().optional(),
  name: z.string().optional(),
  description: z.string().optional(),
  path: z.string().optional(),
  workspace: workspaceSchema,
});

const versionHeaderSchema = z.object({
  containerVersionId: z.string(),
  name: z.string(),
  description: z.string().optional(),
  numTags: z.string().optional(),
  numTriggers: z.string().optional(),
  numVariables: z.string().optional(),
  deleted: z.boolean().optional(),
  fingerprint: z.string().optional(),
  path: z.string(),
});

const versionHistoryEntrySchema = versionHeaderSchema.extend({
  isLive: z.boolean(),
  publishedAt: z.string().optional(),
});

const versionHistoryResultSchema = z.object({
  limit: z.number().int().positive(),
  liveVersionId: z.string().optional(),
  publishDatesAvailable: z.boolean(),
  versions: z.array(versionHistoryEntrySchema),
});

const rollbackChangeSchema = z.object({
  field: z.enum(["name", "description", "numTags", "numTriggers", "numVariables"]),
  label: z.string(),
  from: z.string().optional(),
  to: z.string().optional(),
  changed: z.boolean(),
});

const rollbackResultSchema = z.object({
  dryRun: z.boolean(),
  versionId: z.string(),
  targetVersion: versionHeaderSchema.optional(),
  currentLiveVersion: versionHeaderSchema.nullable().optional(),
  publishedVersion: versionHeaderSchema.nullable().optional(),
  changes: z.array(rollbackChangeSchema),
  published: z.boolean(),
  error: z.string().optional(),
});

const resourceDiffSchema = z.object({
  name: z.string(),
  status: z.enum(["only_in_source", "only_in_target", "different", "identical"]),
  sourceId: z.string().optional(),
  targetId: z.string().optional(),
  differences: z.array(z.string()).optional(),
});

const compareResultSchema = z.object({
  sourceProfile: z.string(),
  targetProfile: z.string(),
  tags: z.array(resourceDiffSchema),
  triggers: z.array(resourceDiffSchema),
  variables: z.array(resourceDiffSchema),
  summary: z.string(),
});

const promotionEnvironmentSchema = z.enum(["development", "staging", "production"]);

const promotionPlanSectionSchema = z.object({
  create: z.array(resourceDiffSchema),
  update: z.array(resourceDiffSchema),
  targetOnly: z.array(resourceDiffSchema),
  identical: z.number().int().nonnegative(),
});

const promotionPlanSchema = z.object({
  sourceProfile: z.string(),
  targetProfile: z.string(),
  sourceEnvironment: promotionEnvironmentSchema,
  targetEnvironment: promotionEnvironmentSchema,
  allowedFlow: z.array(promotionEnvironmentSchema),
  compare: compareResultSchema,
  tags: promotionPlanSectionSchema,
  triggers: promotionPlanSectionSchema,
  variables: promotionPlanSectionSchema,
  totals: z.object({
    create: z.number().int().nonnegative(),
    update: z.number().int().nonnegative(),
    apply: z.number().int().nonnegative(),
    targetOnly: z.number().int().nonnegative(),
    identical: z.number().int().nonnegative(),
  }),
  publishRequested: z.boolean(),
  versionName: z.string().optional(),
  versionDescription: z.string().optional(),
  risk: z.object({
    level: z.enum(["low", "medium", "high"]),
    reasons: z.array(z.string()),
  }),
  warnings: z.array(z.string()),
});

const syncResultSchema = z.object({
  variablesCreated: z.number().int().nonnegative(),
  variablesUpdated: z.number().int().nonnegative(),
  triggersCreated: z.number().int().nonnegative(),
  triggersUpdated: z.number().int().nonnegative(),
  tagsCreated: z.number().int().nonnegative(),
  tagsUpdated: z.number().int().nonnegative(),
  errors: z.array(z.string()),
});

const publishResultSchema = z.object({
  dryRun: z.boolean(),
  versionName: z.string(),
  versionDescription: z.string(),
  versionId: z.string().optional(),
  published: z.boolean(),
  error: z.string().optional(),
  compilerError: z.boolean().nullable().optional(),
  syncStatus: z.record(z.unknown()).optional(),
});

const promotionResultSchema = z.object({
  dryRun: z.boolean(),
  applied: z.boolean(),
  published: z.boolean(),
  plan: promotionPlanSchema,
  syncResult: syncResultSchema.optional(),
  publishResult: publishResultSchema.optional(),
  errors: z.array(z.string()),
});

const planToolOutputSchema = z.union([planResultSchema, toolErrorSchema]);
const driftToolOutputSchema = z.union([driftReportSchema, toolErrorSchema]);
const policyToolOutputSchema = z.union([policyReportSchema, toolErrorSchema]);
const workspaceStatusToolOutputSchema = z.union([workspaceStatusSchema, toolErrorSchema]);
const workspaceCreateToolOutputSchema = z.union([workspaceCreateResultSchema, toolErrorSchema]);
const versionHistoryToolOutputSchema = z.union([versionHistoryResultSchema, toolErrorSchema]);
const rollbackToolOutputSchema = z.union([rollbackResultSchema, toolErrorSchema]);
const promotionToolOutputSchema = z.union([promotionResultSchema, toolErrorSchema]);

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
server.tool(
  "gtm_list_tags",
  "List all GTM tags in the current workspace. Returns each tag's ID, name, type, firing trigger references, and paused status. Use this to understand the current tag landscape before making changes or running audits. Success: a complete JSON array of all tags with their key metadata.",
  {},
  async () => {
    try {
      const tags = await listTags();
      if (tags.length === 0) {
        await verifyGtmConnection();
      }
      const summary = tags.map((t: GtmTag) => ({
        id: t.tagId,
        name: t.name,
        type: t.type,
        triggers: t.firingTriggerId ?? [],
        paused: t.paused ?? false,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Get tag details ---
server.tool(
  "gtm_get_tag",
  "Get the full configuration of a specific GTM tag by its numeric ID. Returns all parameters, consent settings, firing triggers, and metadata. Use this when you need the complete tag definition for debugging, auditing, or cloning. Requires the numeric tag ID from gtm_list_tags.",
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
server.tool(
  "gtm_list_triggers",
  "List all GTM triggers in the current workspace. Returns each trigger's ID, name, and type (page view, custom event, click, etc.). Use this to understand what user actions are being tracked and to find available trigger IDs for creating new tags. Success: a complete JSON array of all triggers.",
  {},
  async () => {
    try {
      const triggers = await listTriggers();
      if (triggers.length === 0) {
        await verifyGtmConnection();
      }
      const summary = triggers.map((t: GtmTrigger) => ({
        id: t.triggerId,
        name: t.name,
        type: t.type,
      }));
      return { content: [{ type: "text", text: JSON.stringify(summary, null, 2) }] };
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- List variables ---
server.tool(
  "gtm_list_variables",
  "List all GTM variables in the current workspace. Returns each variable's ID, name, type, and the data layer key it reads (if applicable). Use this to understand what data is available for tag configuration and to verify variable naming conventions. Success: a complete JSON array of all variables.",
  {},
  async () => {
    try {
      const vars = await listVariables();
      if (vars.length === 0) {
        await verifyGtmConnection();
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
    } catch (err) {
      return { content: [{ type: "text", text: `ERROR: ${(err as Error).message}` }] };
    }
  },
);

// --- Create Custom HTML tag ---
if (!IS_READ_ONLY) {
  server.tool(
    "gtm_create_html_tag",
    "Create a Custom HTML tag in GTM with specified trigger and consent settings. The HTML content is automatically sanitized against dangerous patterns (eval, document.cookie, etc.) and untrusted domains. Use this to implement vendor tracking pixels by providing the HTML snippet, a trigger ID, and the consent type. Always verify the trigger ID exists via gtm_list_triggers first.",
    {
      name: z.string().describe("Tag name, e.g. 'Artsai – Purchase'"),
      html: z.string().describe("HTML content for the tag (script or img)"),
      trigger_id: z.string().describe("Firing trigger ID"),
      consent_type: z
        .string()
        .optional()
        .describe("Consent type: 'ad_storage' or 'analytics_storage'. Default: ad_storage"),
      profile_name: z
        .string()
        .optional()
        .describe("Optional named profile from .gtmrc.json to scope the write operation."),
    },
    async ({ name, html, trigger_id, consent_type, profile_name }) => {
      return await runWithProfile(profile_name, async () => {
        await requireWriteAccess(profile_name);
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
        const result = await createTag(
          {
            name,
            type: "html",
            firingTriggerId: trigger_id,
            config,
          },
          profile_name,
        );
        return {
          content: [
            {
              type: "text",
              text: result.rawResponse ?? JSON.stringify(result, null, 2),
            },
          ],
        };
      });
    },
  );

  // --- Create trigger ---
  server.tool(
    "gtm_create_trigger",
    "Create a Custom Event trigger in GTM that fires when a specific dataLayer event occurs. Optionally filter by page path to restrict firing to specific pages. Use this when implementing new tracking that requires a custom trigger not already in the workspace. Returns the created trigger's metadata including its ID for use in tag creation.",
    {
      name: z.string().describe("Trigger name, e.g. 'CE - Page View (/history)'"),
      event_name: z.string().describe("The dataLayer event name to listen for"),
      page_path_filter: z
        .string()
        .optional()
        .describe("Optional: filter to only fire when Page Path contains this value"),
      profile_name: z
        .string()
        .optional()
        .describe("Optional named profile from .gtmrc.json to scope the write operation."),
    },
    async ({ name, event_name, page_path_filter, profile_name }) => {
      return await runWithProfile(profile_name, async () => {
        await requireWriteAccess(profile_name);
        const config: Record<string, unknown> = {
          customEventFilter: [
            {
              type: "EQUALS",
              parameter: [
                { type: "template", key: "arg0", value: "{{_event}}" },
                { type: "template", key: "arg1", value: event_name },
              ],
            },
          ],
        };
        if (page_path_filter) {
          config.filter = [
            {
              type: "CONTAINS",
              parameter: [
                { type: "template", key: "arg0", value: "{{Page Path}}" },
                { type: "template", key: "arg1", value: page_path_filter },
              ],
            },
          ];
        }
        const trigger = await createTrigger(name, "CUSTOM_EVENT", config, profile_name);
        return {
          content: [
            {
              type: "text",
              text: trigger ? JSON.stringify(trigger, null, 2) : "Trigger created",
            },
          ],
        };
      });
    },
  );
}

// --- Plan workspace restore from a snapshot ---
server.registerTool(
  "gtm_plan_restore",
  {
    description:
      "Preview how the current GTM workspace would be restored to match a saved snapshot. This does not apply changes. Returns create/update/delete actions, counts, safety warnings, and a risk level.",
    inputSchema: {
      snapshot_path: z
        .string()
        .min(1)
        .describe("Path to the GTM snapshot JSON file to compare against the current workspace."),
    },
    outputSchema: planToolOutputSchema,
  },
  async ({ snapshot_path }) => {
    try {
      return okResult(await plan(snapshot_path));
    } catch (err) {
      return errorResult((err as Error).message);
    }
  },
);

// --- Detect drift against a snapshot ---
server.registerTool(
  "gtm_detect_drift",
  {
    description:
      "Detect semantic drift between a saved GTM snapshot and the live workspace. Reports managed drift, unmanaged additions, deleted resources, and summary counts.",
    inputSchema: {
      snapshot_path: z
        .string()
        .optional()
        .describe(
          "Optional path to the GTM snapshot JSON file. Defaults to gtm-snapshot.json in the current directory.",
        ),
    },
    outputSchema: driftToolOutputSchema,
  },
  async ({ snapshot_path }) => {
    try {
      return okResult(await detectDrift(snapshot_path));
    } catch (err) {
      return errorResult((err as Error).message);
    }
  },
);

// --- Run policy checks ---
server.registerTool(
  "gtm_policy_check",
  {
    description:
      "Run TagOps governance policies against the current GTM workspace. Loads the default policy config unless a custom config path is provided and returns violations with severity counts.",
    inputSchema: {
      config_path: z
        .string()
        .optional()
        .describe(
          "Optional path to a policy config JSON file. Defaults to .tagops-policies.json if present.",
        ),
    },
    outputSchema: policyToolOutputSchema,
  },
  async ({ config_path }) => {
    try {
      const [tags, triggers, variables] = await Promise.all([
        listTags(),
        listTriggers(),
        listVariables(),
      ]);

      if (tags.length === 0 && triggers.length === 0 && variables.length === 0) {
        await verifyGtmConnection();
      }

      const policies = loadPoliciesFromConfig(config_path);
      return okResult(evaluatePolicies(tags, triggers, variables, policies));
    } catch (err) {
      return errorResult((err as Error).message);
    }
  },
);

// --- Inspect current workspace sync status ---
server.registerTool(
  "gtm_workspace_status",
  {
    description:
      "Get the current GTM draft workspace sync state. Returns whether the workspace is synced plus merge conflicts and pending workspace changes.",
    inputSchema: {},
    outputSchema: workspaceStatusToolOutputSchema,
  },
  async () => {
    try {
      const { getWorkspaceStatus } = await import("./lib/gtm-cli.js");
      const status = await getWorkspaceStatus();
      return okResult({
        synced: status.synced,
        mergeConflictCount: status.mergeConflict.length,
        pendingChangeCount: status.workspaceChange.length,
        mergeConflict: status.mergeConflict,
        workspaceChange: status.workspaceChange,
      });
    } catch (err) {
      return errorResult((err as Error).message);
    }
  },
);

// --- Create a new workspace ---
if (!IS_READ_ONLY) {
  server.registerTool(
    "gtm_workspace_create",
    {
      description:
        "Create a new isolated GTM draft workspace for safe changes. Returns the created workspace metadata including the new workspace ID.",
      inputSchema: {
        name: z.string().min(1).describe("Human-readable name for the new draft workspace."),
        description: z
          .string()
          .optional()
          .describe("Optional description explaining the workspace purpose."),
        profile_name: z
          .string()
          .optional()
          .describe("Optional named profile from .gtmrc.json to scope the workspace creation."),
      },
      outputSchema: workspaceCreateToolOutputSchema,
    },
    async ({ name, description, profile_name }) => {
      return await runWithProfile(profile_name, async () => {
        try {
          await requireWriteAccess(profile_name);
          const { createWorkspace } = await import("./lib/gtm-cli.js");
          const workspace = await createWorkspace(name, description, profile_name);
          return okResult({
            created: true as const,
            workspaceId: workspace.workspaceId ?? undefined,
            name: workspace.name ?? undefined,
            description: workspace.description ?? undefined,
            path: workspace.path ?? undefined,
            workspace,
          });
        } catch (err) {
          return errorResult((err as Error).message);
        }
      });
    },
  );
}

// --- List recent versions ---
server.registerTool(
  "gtm_list_versions",
  {
    description:
      "List recent GTM container versions, including which version is currently live. Useful before rollback or release decisions.",
    inputSchema: {
      limit: z
        .number()
        .int()
        .min(1)
        .max(50)
        .optional()
        .describe("Maximum number of recent versions to return. Defaults to 10."),
    },
    outputSchema: versionHistoryToolOutputSchema,
  },
  async ({ limit }) => {
    try {
      return okResult(await listVersionHistory(limit));
    } catch (err) {
      return errorResult((err as Error).message);
    }
  },
);

// --- Roll back to a previous version ---
server.registerTool(
  "gtm_rollback",
  {
    description:
      "Roll the live GTM container back to a previous published version, or preview the rollback in dry-run mode. Returns the target version, current live version, and a change summary.",
    inputSchema: {
      version_id: z.string().min(1).describe("Container version ID to roll back to."),
      dry_run: z
        .boolean()
        .optional()
        .describe("If true, preview the rollback without publishing the target version."),
      profile_name: z
        .string()
        .optional()
        .describe("Optional named profile from .gtmrc.json to scope the rollback."),
    },
    outputSchema: rollbackToolOutputSchema,
  },
  async ({ version_id, dry_run, profile_name }) => {
    return await runWithProfile(profile_name, async () => {
      try {
        if (IS_READ_ONLY && !dry_run) {
          return errorResult(
            "Server is running in --read-only mode. Rollback publish is disabled.",
          );
        }

        if (!dry_run) {
          await requireWriteAccess(profile_name);
        }

        return okResult(await rollback(version_id, { dryRun: dry_run }));
      } catch (err) {
        return errorResult((err as Error).message);
      }
    });
  },
);

// --- Promote one profile into another ---
server.registerTool(
  "gtm_promote",
  {
    description:
      "Promote GTM changes from a source profile into a target profile. In dry-run mode it returns the promotion plan only. In apply mode it syncs create/update changes into the target profile without deleting target-only drift.",
    inputSchema: {
      source_profile: z.string().min(1).describe("Source profile name from .gtmrc.json."),
      target_profile: z.string().min(1).describe("Target profile name from .gtmrc.json."),
      dry_run: z
        .boolean()
        .optional()
        .describe("If true, return the promotion plan without applying any changes."),
    },
    outputSchema: promotionToolOutputSchema,
  },
  async ({ source_profile, target_profile, dry_run }) => {
    return await runWithProfile(target_profile, async () => {
      try {
        if (IS_READ_ONLY && !dry_run) {
          return errorResult("Server is running in --read-only mode. Promotion apply is disabled.");
        }

        if (!dry_run) {
          await requireWriteAccess(target_profile);
        }

        return okResult(
          await promote(source_profile, target_profile, {
            dryRun: dry_run,
            force: true,
            silent: true,
          }),
        );
      } catch (err) {
        return errorResult((err as Error).message);
      }
    });
  },
);

// --- Audit workspace ---
server.tool(
  "gtm_audit",
  "Perform a comprehensive workspace health check identifying missing triggers, incorrect consent settings, orphaned triggers, paused tags, duplicate names, and risky custom HTML. Use this regularly to maintain workspace hygiene and catch configuration errors before they reach production. Returns a categorized issue report with actionable findings.",
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
  "Analyze all tags for Google Consent Mode v2 compliance across the four required consent signals (ad_storage, ad_user_data, ad_personalization, analytics_storage). Use this to ensure GDPR/CCPA privacy regulation compliance before deployments. Returns a compliance percentage score with per-tag signal breakdown. Includes optional dry-run auto-fix mode to preview what consent corrections would be applied.",
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
  "Perform a system-wide health check of your TagOps installation. Validates Node.js version, .gtmrc.json configuration, authentication credentials, API connectivity, workspace resource access, and consent compliance. Use this first when troubleshooting setup issues or to verify a fresh installation is working correctly.",
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
  "Generate an overall workspace quality assessment combining multiple health factors into a single 0-100 score and letter grade (A-F). Evaluates consent compliance, naming conventions, tag hygiene, custom HTML security risks, trigger coverage, duplicate detection, and container size. Use this for regular monitoring or as a CI gate to enforce minimum quality standards.",
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
  "Verify that Google Ads Enhanced Conversions are configured correctly per current requirements. Checks for user-provided data event tags, proper trigger alignment, consent signal configuration, and PII collection compliance. Use this when implementing or auditing conversion tracking to ensure compliance with Google's privacy requirements.",
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
  "Evaluate your workspace's readiness for server-side tagging implementation. Analyzes which tags can be migrated to server-side, reviews browser routing configuration, server clients and transformations, and tagging-server domain setup. Use this when planning SST migration to understand the effort required and identify blockers.",
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
  "Analyze configuration differences between two GTM environments (e.g., staging vs production) using named profiles from .gtmrc.json. Shows which tags, triggers, and variables differ, exist only in one container, or are identical. Use this before promotions to understand exactly what will change, or to diagnose environment inconsistencies.",
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
    "Copy GTM configuration elements from one environment to another while maintaining proper trigger-tag relationships through automatic ID remapping. Use this to deploy tested configurations from staging to production or sync environments after divergence. Supports dry-run preview mode to see exactly what would change before committing.",
    {
      source_profile: z.string().describe("Source profile name from .gtmrc.json"),
      target_profile: z.string().describe("Target profile name from .gtmrc.json"),
      dry_run: z.boolean().optional().describe("Preview changes without actually syncing"),
    },
    async ({ source_profile, target_profile, dry_run }) => {
      return await runWithProfile(target_profile, async () => {
        try {
          if (!dry_run) {
            await requireWriteAccess(target_profile);
          }
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
      });
    },
  );
}

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
  profileName?: string,
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
  const trigger = await createTrigger(
    triggerName,
    "CUSTOM_EVENT",
    {
      customEventFilter: [
        {
          type: "EQUALS",
          parameter: [
            { type: "template", key: "arg0", value: "{{_event}}" },
            { type: "template", key: "arg1", value: eventName },
          ],
        },
      ],
      filter: [
        {
          type: "CONTAINS",
          parameter: [
            { type: "template", key: "arg0", value: "{{Page Path}}" },
            { type: "template", key: "arg1", value: pageFilter },
          ],
        },
      ],
    },
    profileName,
  );

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
      profile_name: z
        .string()
        .optional()
        .describe("Optional named profile from .gtmrc.json to scope the write operation."),
    },
    async ({ vendor_name, pixel_id, pixels, dry_run, profile_name }) => {
      return await runWithProfile(profile_name, async () => {
        const { findTemplateIdByVendor, previewTemplate } = await import("./templates/registry.js");

        if (!dry_run) {
          await requireWriteAccess(profile_name);
        }

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

          const triggerId = await resolveTriggerForPlan(
            plan.triggerEvent,
            plan.pageFilter,
            dry_run,
            profile_name,
          );

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
            const createResult = await createTag(
              {
                name: plan.name,
                type: "html",
                firingTriggerId: triggerId,
                config,
              },
              profile_name,
            );
            results.push({
              action: createResult.created
                ? "CREATED"
                : createResult.duplicate
                  ? "SKIPPED"
                  : "ERROR",
              tagName: plan.name,
              triggerId,
              result: (createResult.rawResponse ?? JSON.stringify(createResult, null, 2)).substring(
                0,
                200,
              ),
            });
          }
        }

        return { content: [{ type: "text", text: JSON.stringify(results, null, 2) }] };
      });
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
