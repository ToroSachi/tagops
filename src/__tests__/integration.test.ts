import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../lib/gtm-cli.js", () => ({
  getContainer: vi.fn(),
  listTags: vi.fn(),
  listTriggers: vi.fn(),
  listVariables: vi.fn(),
  listFolders: vi.fn(),
  listBuiltInVariables: vi.fn(),
  listEnvironments: vi.fn(),
  listClients: vi.fn(),
  listTransformations: vi.fn(),
  buildCompleteTagConfig: vi.fn((tag: object, overrides: Record<string, unknown> = {}) => ({
    ...(structuredClone(tag) as Record<string, unknown>),
    ...overrides,
  })),
  createFolder: vi.fn(),
  updateFolder: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  createTrigger: vi.fn(),
  updateTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  createVariable: vi.fn(),
  updateVariable: vi.fn(),
  deleteVariable: vi.fn(),
  listVersions: vi.fn(),
  getVersionDetails: vi.fn(),
  getLatestPublishedVersion: vi.fn(),
  rollbackToVersion: vi.fn(),
}));

vi.mock("../lib/config.js", () => ({
  loadConfig: vi.fn(),
}));

vi.mock("../lib/permission-guard.js", () => ({
  requireWriteAccess: vi.fn(),
  requirePublishAccess: vi.fn(),
}));

import * as config from "../lib/config.js";
import * as gtmCli from "../lib/gtm-cli.js";
import * as permissionGuard from "../lib/permission-guard.js";
import { evaluatePolicies, getBuiltInPolicies } from "../lib/policies.js";
import { summarizeDriftChanges, detectDrift } from "../tools/drift.js";
import { plan } from "../tools/plan.js";
import { listVersionHistory, rollback } from "../tools/rollback.js";
import { restoreWorkspace } from "../tools/restore.js";
import { takeSnapshot } from "../tools/snapshot.js";
import type {
  GtmBuiltInVariable,
  GtmClient,
  GtmEnvironment,
  GtmFolder,
  GtmTag,
  GtmTransformation,
  GtmTrigger,
  GtmVariable,
  GtmVersionHeader,
} from "../types/gtm.js";

const CONFIG = {
  accountId: "123456",
  containerId: "654321",
  workspaceId: "11",
};

const TAGOPS_IDS = {
  purchaseTrigger: "11111111-1111-1111-1111-111111111111",
  purchaseTag: "22222222-2222-2222-2222-222222222222",
  metaTag: "33333333-3333-3333-3333-333333333333",
  driftTag: "44444444-4444-4444-4444-444444444444",
  driftTrigger: "55555555-5555-5555-5555-555555555555",
  driftVariable: "66666666-6666-6666-6666-666666666666",
};

interface WorkspaceState {
  tags: GtmTag[];
  triggers: GtmTrigger[];
  variables: GtmVariable[];
  folders: GtmFolder[];
  builtInVariables: GtmBuiltInVariable[];
  environments: GtmEnvironment[];
  clients: GtmClient[];
  transformations: GtmTransformation[];
}

let tempDir = "";

function tagOpsNote(id: string, note?: string): string {
  return [note, `TagOps-ID: ${id}`].filter(Boolean).join("\n");
}

function makeTag(
  overrides: Partial<GtmTag> & { tagId: string; name: string; type: string },
): GtmTag {
  return {
    tagId: overrides.tagId,
    name: overrides.name,
    type: overrides.type,
    fingerprint: overrides.fingerprint ?? `fp-${overrides.tagId}`,
    firingTriggerId: overrides.firingTriggerId ?? [],
    blockingTriggerId: overrides.blockingTriggerId ?? [],
    parameter: overrides.parameter ?? [],
    consentSettings: overrides.consentSettings,
    notes: overrides.notes,
    paused: overrides.paused,
    parentFolderId: overrides.parentFolderId,
    tagFiringOption: overrides.tagFiringOption,
  };
}

function makeTrigger(
  overrides: Partial<GtmTrigger> & { triggerId: string; name: string; type: string },
): GtmTrigger {
  return {
    triggerId: overrides.triggerId,
    name: overrides.name,
    type: overrides.type,
    fingerprint: overrides.fingerprint ?? `fp-${overrides.triggerId}`,
    customEventFilter: overrides.customEventFilter ?? [],
    filter: overrides.filter ?? [],
    parentFolderId: overrides.parentFolderId,
    notes: overrides.notes,
  };
}

function makeVariable(
  overrides: Partial<GtmVariable> & { variableId: string; name: string; type: string },
): GtmVariable {
  return {
    variableId: overrides.variableId,
    name: overrides.name,
    type: overrides.type,
    fingerprint: overrides.fingerprint ?? `fp-${overrides.variableId}`,
    parameter: overrides.parameter ?? [],
    parentFolderId: overrides.parentFolderId,
    notes: overrides.notes,
  };
}

function makeFolder(overrides: Partial<GtmFolder> & { folderId: string; name: string }): GtmFolder {
  return {
    folderId: overrides.folderId,
    name: overrides.name,
    notes: overrides.notes,
    fingerprint: overrides.fingerprint ?? `fp-${overrides.folderId}`,
    path:
      overrides.path ??
      `accounts/${CONFIG.accountId}/containers/${CONFIG.containerId}/workspaces/${CONFIG.workspaceId}/folders/${overrides.folderId}`,
    accountId: CONFIG.accountId,
    containerId: CONFIG.containerId,
    workspaceId: CONFIG.workspaceId,
  };
}

function makeBuiltInVariable(
  overrides: Partial<GtmBuiltInVariable> & { name: string; type: string },
): GtmBuiltInVariable {
  return {
    name: overrides.name,
    type: overrides.type,
    path:
      overrides.path ??
      `accounts/${CONFIG.accountId}/containers/${CONFIG.containerId}/workspaces/${CONFIG.workspaceId}/built_in_variables/${overrides.name}`,
    accountId: CONFIG.accountId,
    containerId: CONFIG.containerId,
    workspaceId: CONFIG.workspaceId,
  };
}

function makeEnvironment(
  overrides: Partial<GtmEnvironment> & { environmentId: string; name: string; type: string },
): GtmEnvironment {
  return {
    environmentId: overrides.environmentId,
    name: overrides.name,
    type: overrides.type,
    description: overrides.description,
    url: overrides.url,
    fingerprint: overrides.fingerprint ?? `fp-${overrides.environmentId}`,
    path:
      overrides.path ??
      `accounts/${CONFIG.accountId}/containers/${CONFIG.containerId}/environments/${overrides.environmentId}`,
  };
}

function makeClient(
  overrides: Partial<GtmClient> & { clientId: string; name: string; type: string },
): GtmClient {
  return {
    clientId: overrides.clientId,
    name: overrides.name,
    type: overrides.type,
    parameter: overrides.parameter ?? [],
    priority: overrides.priority,
    fingerprint: overrides.fingerprint ?? `fp-${overrides.clientId}`,
    path:
      overrides.path ??
      `accounts/${CONFIG.accountId}/containers/${CONFIG.containerId}/workspaces/${CONFIG.workspaceId}/clients/${overrides.clientId}`,
    notes: overrides.notes,
    parentFolderId: overrides.parentFolderId,
    accountId: CONFIG.accountId,
    containerId: CONFIG.containerId,
    workspaceId: CONFIG.workspaceId,
  };
}

function makeTransformation(
  overrides: Partial<GtmTransformation> & {
    transformationId: string;
    name: string;
    type: string;
  },
): GtmTransformation {
  return {
    transformationId: overrides.transformationId,
    name: overrides.name,
    type: overrides.type,
    parameter: overrides.parameter ?? [],
    fingerprint: overrides.fingerprint ?? `fp-${overrides.transformationId}`,
    path:
      overrides.path ??
      `accounts/${CONFIG.accountId}/containers/${CONFIG.containerId}/workspaces/${CONFIG.workspaceId}/transformations/${overrides.transformationId}`,
    notes: overrides.notes,
    parentFolderId: overrides.parentFolderId,
    accountId: CONFIG.accountId,
    containerId: CONFIG.containerId,
    workspaceId: CONFIG.workspaceId,
  };
}

function makeVersion(
  overrides: Partial<GtmVersionHeader> & { containerVersionId: string; name: string },
): GtmVersionHeader {
  return {
    containerVersionId: overrides.containerVersionId,
    name: overrides.name,
    description: overrides.description,
    numTags: overrides.numTags ?? "0",
    numTriggers: overrides.numTriggers ?? "0",
    numVariables: overrides.numVariables ?? "0",
    deleted: overrides.deleted,
    fingerprint: overrides.fingerprint ?? `fp-${overrides.containerVersionId}`,
    path:
      overrides.path ??
      `accounts/${CONFIG.accountId}/containers/${CONFIG.containerId}/versions/${overrides.containerVersionId}`,
  };
}

function setWorkspaceState(state: Partial<WorkspaceState>): void {
  vi.mocked(gtmCli.listTags).mockResolvedValue(state.tags ?? []);
  vi.mocked(gtmCli.listTriggers).mockResolvedValue(state.triggers ?? []);
  vi.mocked(gtmCli.listVariables).mockResolvedValue(state.variables ?? []);
  vi.mocked(gtmCli.listFolders).mockResolvedValue(state.folders ?? []);
  vi.mocked(gtmCli.listBuiltInVariables).mockResolvedValue(state.builtInVariables ?? []);
  vi.mocked(gtmCli.listEnvironments).mockResolvedValue(state.environments ?? []);
  vi.mocked(gtmCli.listClients).mockResolvedValue(state.clients ?? []);
  vi.mocked(gtmCli.listTransformations).mockResolvedValue(state.transformations ?? []);
}

function actionKeys(
  actions: Array<{ action: string; resourceType: string; name: string }>,
): string[] {
  return actions
    .map((action) => `${action.action}:${action.resourceType}:${action.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function changeKeys(report: ReturnType<typeof summarizeDriftChanges>): string[] {
  return report
    .map((entry) => `${entry.classification}:${entry.changeType}:${entry.type}:${entry.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function snapshotPath(name: string): string {
  return join(tempDir, name);
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "tagops-integration-"));
  vi.clearAllMocks();
  vi.mocked(config.loadConfig).mockReturnValue(CONFIG);
  vi.mocked(gtmCli.getContainer).mockResolvedValue({ features: {} } as never);
  vi.mocked(gtmCli.listVersions).mockResolvedValue([]);
  vi.mocked(gtmCli.getVersionDetails).mockResolvedValue(null);
  vi.mocked(gtmCli.getLatestPublishedVersion).mockResolvedValue(null);
  vi.mocked(gtmCli.rollbackToVersion).mockResolvedValue(null);
  setWorkspaceState({
    tags: [],
    triggers: [],
    variables: [],
    folders: [],
    builtInVariables: [],
    environments: [],
    clients: [],
    transformations: [],
  });
});

afterEach(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("validation harness", () => {
  it("runs the full IaC lifecycle from snapshot to plan to restore dry-run", async () => {
    const baseline = {
      folders: [
        makeFolder({ folderId: "folder-core", name: "Core", notes: "Core folder" }),
        makeFolder({ folderId: "folder-archive", name: "Archive", notes: "Archive folder" }),
      ],
      triggers: [
        makeTrigger({
          triggerId: "snap-trigger-purchase",
          name: "CE - Purchase",
          type: "CUSTOM_EVENT",
          notes: tagOpsNote(TAGOPS_IDS.purchaseTrigger),
          customEventFilter: [
            {
              type: "EQUALS",
              parameter: [
                { type: "template", key: "arg0", value: "{{_event}}" },
                { type: "template", key: "arg1", value: "purchase" },
              ],
            },
          ],
        }),
        makeTrigger({
          triggerId: "snap-trigger-page",
          name: "All Pages",
          type: "PAGEVIEW",
        }),
      ],
      variables: [
        makeVariable({
          variableId: "snap-variable-value",
          name: "DLV - Value",
          type: "v",
          notes: tagOpsNote("77777777-7777-7777-7777-777777777777"),
          parameter: [{ type: "template", key: "name", value: "ecommerce.value" }],
          parentFolderId: "folder-core",
        }),
      ],
      tags: [
        makeTag({
          tagId: "snap-tag-ga4-purchase",
          name: "GA4 - Purchase",
          type: "gaawe",
          notes: tagOpsNote(TAGOPS_IDS.purchaseTag),
          firingTriggerId: ["snap-trigger-purchase"],
          parentFolderId: "folder-core",
          parameter: [{ type: "template", key: "eventName", value: "purchase" }],
          consentSettings: {
            consentStatus: "needed",
            consentType: {
              type: "list",
              list: [{ type: "template", value: "analytics_storage" }],
            },
          },
        }),
        makeTag({
          tagId: "snap-tag-meta-pageview",
          name: "Meta - Page View",
          type: "html",
          notes: tagOpsNote(TAGOPS_IDS.metaTag),
          firingTriggerId: ["snap-trigger-page"],
          parentFolderId: "folder-core",
          parameter: [
            { type: "template", key: "html", value: "<script>fbq('track','PageView')</script>" },
            { type: "template", key: "event_id", value: "{{Event ID}}" },
          ],
          consentSettings: {
            consentStatus: "needed",
            consentType: {
              type: "list",
              list: [
                { type: "template", value: "ad_storage" },
                { type: "template", value: "ad_user_data" },
                { type: "template", value: "ad_personalization" },
              ],
            },
          },
        }),
      ],
    };

    const modifiedWorkspace = {
      folders: [makeFolder({ folderId: "folder-core", name: "Core", notes: "Core folder v2" })],
      triggers: [
        makeTrigger({
          triggerId: "live-trigger-purchase",
          name: "CE - Purchase",
          type: "CUSTOM_EVENT",
          notes: tagOpsNote(TAGOPS_IDS.purchaseTrigger),
          customEventFilter: [
            {
              type: "EQUALS",
              parameter: [
                { type: "template", key: "arg0", value: "{{_event}}" },
                { type: "template", key: "arg1", value: "begin_checkout" },
              ],
            },
          ],
        }),
        makeTrigger({
          triggerId: "snap-trigger-page",
          name: "All Pages",
          type: "PAGEVIEW",
        }),
        makeTrigger({
          triggerId: "live-trigger-legacy",
          name: "Legacy Trigger",
          type: "CUSTOM_EVENT",
        }),
      ],
      variables: [
        makeVariable({
          variableId: "snap-variable-value",
          name: "DLV - Value",
          type: "v",
          notes: tagOpsNote("77777777-7777-7777-7777-777777777777"),
          parameter: [{ type: "template", key: "name", value: "ecommerce.value" }],
          parentFolderId: "folder-core",
        }),
        makeVariable({
          variableId: "live-variable-legacy",
          name: "Legacy Variable",
          type: "c",
          parameter: [{ type: "template", key: "value", value: "legacy" }],
        }),
      ],
      tags: [
        makeTag({
          tagId: "live-tag-ga4-purchase",
          name: "GA4 - Purchase",
          type: "gaawe",
          notes: tagOpsNote(TAGOPS_IDS.purchaseTag),
          firingTriggerId: ["live-trigger-purchase"],
          parentFolderId: "folder-core",
          parameter: [{ type: "template", key: "eventName", value: "begin_checkout" }],
          consentSettings: {
            consentStatus: "notSet",
          },
        }),
        makeTag({
          tagId: "live-tag-legacy",
          name: "Legacy Tag",
          type: "html",
          firingTriggerId: ["snap-trigger-page"],
          parameter: [{ type: "template", key: "html", value: "<script>legacy()</script>" }],
        }),
      ],
    };

    const file = snapshotPath("iac-lifecycle.json");

    setWorkspaceState({
      ...baseline,
      builtInVariables: [],
      environments: [],
      clients: [],
      transformations: [],
    });
    const snapshotResult = await takeSnapshot(file);

    expect(snapshotResult).toMatchObject({
      path: file,
      folderCount: 2,
      triggerCount: 2,
      variableCount: 1,
      tagCount: 2,
    });

    setWorkspaceState({
      ...modifiedWorkspace,
      builtInVariables: [],
      environments: [],
      clients: [],
      transformations: [],
    });
    const planResult = await plan(file, { allowDelete: true, includeFolders: true });

    expect(actionKeys(planResult.actions)).toEqual([
      "create:folder:Archive",
      "create:tag:Meta - Page View",
      "delete:tag:Legacy Tag",
      "delete:trigger:Legacy Trigger",
      "delete:variable:Legacy Variable",
      "update:folder:Core",
      "update:tag:GA4 - Purchase",
      "update:trigger:CE - Purchase",
    ]);
    expect(planResult.resourceCounts.total).toMatchObject({
      create: 2,
      update: 3,
      delete: 3,
    });
    expect(planResult.actions.find((action) => action.name === "GA4 - Purchase")?.changes).toEqual([
      "consentSettings",
      "parameter",
    ]);
    expect(planResult.actions.find((action) => action.name === "CE - Purchase")?.changes).toEqual([
      "customEventFilter",
    ]);

    const restoreResult = await restoreWorkspace(file, { dryRun: true, allowDelete: true });

    expect(actionKeys(restoreResult.actions.filter((action) => action.action !== "skip"))).toEqual(
      actionKeys(planResult.actions),
    );
    expect(restoreResult.summary).toMatchObject({
      created: 2,
      updated: 3,
      deleted: 3,
      failed: 0,
    });
    expect(gtmCli.createFolder).not.toHaveBeenCalled();
    expect(gtmCli.updateFolder).not.toHaveBeenCalled();
    expect(gtmCli.createTag).not.toHaveBeenCalled();
    expect(gtmCli.updateTag).not.toHaveBeenCalled();
    expect(gtmCli.deleteTag).not.toHaveBeenCalled();
    expect(gtmCli.deleteTrigger).not.toHaveBeenCalled();
    expect(gtmCli.deleteVariable).not.toHaveBeenCalled();
  });

  it("enforces consent and safety policies and leaves clean tags untouched", () => {
    const spaTrigger = makeTrigger({
      triggerId: "trigger-spa",
      name: "CE - Page View",
      type: "CUSTOM_EVENT",
      customEventFilter: [
        {
          type: "EQUALS",
          parameter: [
            { type: "template", key: "arg0", value: "{{_event}}" },
            { type: "template", key: "arg1", value: "page_view" },
          ],
        },
      ],
    });
    const purchaseTrigger = makeTrigger({
      triggerId: "trigger-purchase",
      name: "CE - Purchase",
      type: "CUSTOM_EVENT",
      customEventFilter: [
        {
          type: "EQUALS",
          parameter: [
            { type: "template", key: "arg0", value: "{{_event}}" },
            { type: "template", key: "arg1", value: "purchase" },
          ],
        },
      ],
    });
    const orphanTrigger = makeTrigger({
      triggerId: "trigger-orphaned",
      name: "CE - Orphaned",
      type: "CUSTOM_EVENT",
    });

    const policies = getBuiltInPolicies().filter((policy) =>
      [
        "consent-v2-advertising",
        "consent-v2-analytics",
        "spa-firing-safety",
        "no-document-write",
        "meta-dedup",
        "no-orphaned-triggers",
      ].includes(policy.id),
    );

    const violatingTags = [
      makeTag({
        tagId: "tag-meta-bad",
        name: "Meta - Page View",
        type: "html",
        firingTriggerId: ["trigger-spa"],
        tagFiringOption: "unlimited",
        parameter: [
          { type: "template", key: "html", value: "<script>fbq('track','PageView')</script>" },
          { type: "boolean", key: "supportDocumentWrite", value: "true" },
        ],
        consentSettings: {
          consentStatus: "needed",
          consentType: {
            type: "list",
            list: [{ type: "template", value: "ad_storage" }],
          },
        },
      }),
      makeTag({
        tagId: "tag-ga4-bad",
        name: "GA4 - Purchase",
        type: "gaawe",
        firingTriggerId: ["trigger-purchase"],
        consentSettings: {
          consentStatus: "needed",
          consentType: { type: "list", list: [] },
        },
      }),
    ];

    const violatingReport = evaluatePolicies(
      violatingTags,
      [spaTrigger, purchaseTrigger, orphanTrigger],
      [],
      policies,
    );

    expect(
      violatingReport.violations.map(
        (violation) => `${violation.policyId}:${violation.resourceName}`,
      ),
    ).toEqual([
      "consent-v2-analytics:GA4 - Purchase",
      "consent-v2-advertising:Meta - Page View",
      "no-document-write:Meta - Page View",
      "meta-dedup:Meta - Page View",
      "spa-firing-safety:Meta - Page View",
      "no-orphaned-triggers:CE - Orphaned",
    ]);
    expect(violatingReport.summary).toMatchObject({
      errors: 4,
      warnings: 1,
      info: 1,
      total: 6,
    });

    const cleanReport = evaluatePolicies(
      [
        makeTag({
          tagId: "tag-meta-clean",
          name: "Meta - Purchase",
          type: "html",
          firingTriggerId: ["trigger-purchase"],
          tagFiringOption: "oncePerEvent",
          parameter: [
            { type: "template", key: "html", value: "<script>fbq('track','Purchase')</script>" },
            { type: "template", key: "event_id", value: "{{Event ID}}" },
          ],
          consentSettings: {
            consentStatus: "needed",
            consentType: {
              type: "list",
              list: [
                { type: "template", value: "ad_storage" },
                { type: "template", value: "ad_user_data" },
                { type: "template", value: "ad_personalization" },
              ],
            },
          },
        }),
        makeTag({
          tagId: "tag-ga4-clean",
          name: "GA4 - Purchase",
          type: "gaawe",
          firingTriggerId: ["trigger-purchase"],
          tagFiringOption: "oncePerEvent",
          consentSettings: {
            consentStatus: "needed",
            consentType: {
              type: "list",
              list: [{ type: "template", value: "analytics_storage" }],
            },
          },
        }),
      ],
      [purchaseTrigger],
      [],
      policies,
    );

    expect(cleanReport.violations).toEqual([]);
    expect(cleanReport.summary.total).toBe(0);
    expect(cleanReport.passed).toBe(true);
  });

  it("detects managed and unmanaged drift from a saved snapshot", async () => {
    const baseline = {
      folders: [],
      tags: [
        makeTag({
          tagId: "snap-tag-managed",
          name: "GA4 - Purchase",
          type: "gaawe",
          notes: tagOpsNote(TAGOPS_IDS.driftTag),
          firingTriggerId: ["snap-trigger-page"],
          parameter: [{ type: "template", key: "eventName", value: "purchase" }],
        }),
        makeTag({
          tagId: "snap-tag-unmanaged",
          name: "Legacy Heatmap",
          type: "html",
          firingTriggerId: ["snap-trigger-page"],
          parameter: [{ type: "template", key: "html", value: "<script>old()</script>" }],
        }),
      ],
      triggers: [
        makeTrigger({
          triggerId: "snap-trigger-managed",
          name: "CE - Purchase",
          type: "CUSTOM_EVENT",
          notes: tagOpsNote(TAGOPS_IDS.driftTrigger),
          customEventFilter: [
            {
              type: "EQUALS",
              parameter: [
                { type: "template", key: "arg0", value: "{{_event}}" },
                { type: "template", key: "arg1", value: "purchase" },
              ],
            },
          ],
        }),
      ],
      variables: [
        makeVariable({
          variableId: "snap-variable-managed",
          name: "DLV - Value",
          type: "v",
          notes: tagOpsNote(TAGOPS_IDS.driftVariable),
          parameter: [{ type: "template", key: "name", value: "ecommerce.value" }],
        }),
      ],
    };

    const live = {
      folders: [],
      tags: [
        makeTag({
          tagId: "snap-tag-managed",
          name: "GA4 - Purchase",
          type: "gaawe",
          notes: tagOpsNote(TAGOPS_IDS.driftTag),
          firingTriggerId: ["snap-trigger-page"],
          parameter: [{ type: "template", key: "eventName", value: "begin_checkout" }],
        }),
        makeTag({
          tagId: "snap-tag-unmanaged",
          name: "Legacy Heatmap",
          type: "html",
          firingTriggerId: ["snap-trigger-page"],
          parameter: [{ type: "template", key: "html", value: "<script>new()</script>" }],
        }),
        makeTag({
          tagId: "live-tag-unmanaged-added",
          name: "Ad Hoc Pixel",
          type: "html",
          firingTriggerId: ["snap-trigger-page"],
          parameter: [{ type: "template", key: "html", value: "<script>adhoc()</script>" }],
        }),
      ],
      triggers: [],
      variables: [
        makeVariable({
          variableId: "snap-variable-managed",
          name: "DLV - Value",
          type: "v",
          notes: tagOpsNote(TAGOPS_IDS.driftVariable),
          parameter: [{ type: "template", key: "name", value: "ecommerce.value" }],
        }),
      ],
    };

    const file = snapshotPath("drift.json");

    setWorkspaceState({
      ...baseline,
      builtInVariables: [],
      environments: [],
      clients: [],
      transformations: [],
    });
    await takeSnapshot(file);

    setWorkspaceState({
      ...live,
      builtInVariables: [],
      environments: [],
      clients: [],
      transformations: [],
    });
    const report = await detectDrift(file);

    expect(changeKeys(summarizeDriftChanges(report))).toEqual([
      "managed:deleted:trigger:CE - Purchase",
      "managed:modified:tag:GA4 - Purchase",
      "unmanaged:added:tag:Ad Hoc Pixel",
      "unmanaged:modified:tag:Legacy Heatmap",
    ]);
    expect(report.unmanagedResources.map((entry) => `${entry.changeType}:${entry.name}`)).toEqual([
      "added:Ad Hoc Pixel",
      "modified:Legacy Heatmap",
    ]);
    expect(report.deletedResources.map((entry) => `${entry.classification}:${entry.name}`)).toEqual(
      ["managed:CE - Purchase"],
    );
    expect(report.summary).toMatchObject({
      totalChanges: 4,
      unmanagedResources: 2,
      deletedResources: 1,
      managedChanges: 2,
      unmanagedChanges: 2,
    });
  });

  it("formats version history and keeps rollback dry-run side-effect free", async () => {
    const versions = [
      makeVersion({
        containerVersionId: "105",
        name: "Release 105",
        description: "Current live",
        numTags: "12",
        numTriggers: "8",
        numVariables: "5",
      }),
      makeVersion({
        containerVersionId: "104",
        name: "Release 104",
        description: "Previous stable",
        numTags: "11",
        numTriggers: "8",
        numVariables: "5",
      }),
      makeVersion({
        containerVersionId: "103",
        name: "Release 103",
        description: "Older",
        numTags: "10",
        numTriggers: "7",
        numVariables: "4",
      }),
    ];

    const versionDetails = new Map(
      versions.map((version) => [version.containerVersionId, version]),
    );

    vi.mocked(gtmCli.listVersions).mockResolvedValue(versions);
    vi.mocked(gtmCli.getLatestPublishedVersion).mockResolvedValue(versions[0]);
    vi.mocked(gtmCli.getVersionDetails).mockImplementation(
      async (versionId) => versionDetails.get(versionId) ?? null,
    );

    const history = await listVersionHistory(2);

    expect(history).toEqual({
      limit: 2,
      liveVersionId: "105",
      publishDatesAvailable: false,
      versions: [
        { ...versions[0], isLive: true, publishedAt: undefined },
        { ...versions[1], isLive: false, publishedAt: undefined },
      ],
    });
    expect(gtmCli.getVersionDetails).toHaveBeenCalledTimes(2);
    expect(gtmCli.getVersionDetails).toHaveBeenNthCalledWith(1, "105");
    expect(gtmCli.getVersionDetails).toHaveBeenNthCalledWith(2, "104");

    const rollbackResult = await rollback("104", { dryRun: true });

    expect(rollbackResult).toMatchObject({
      dryRun: true,
      versionId: "104",
      published: false,
      targetVersion: versions[1],
      currentLiveVersion: versions[0],
    });
    expect(
      rollbackResult.changes.filter((change) => change.changed).map((change) => change.field),
    ).toEqual(["name", "description", "numTags"]);
    expect(permissionGuard.requirePublishAccess).not.toHaveBeenCalled();
    expect(gtmCli.rollbackToVersion).not.toHaveBeenCalled();
  });

  it("captures a complete snapshot including every supported resource type", async () => {
    const file = snapshotPath("complete-snapshot.json");
    const state = {
      folders: [makeFolder({ folderId: "folder-server", name: "Server" })],
      tags: [
        makeTag({
          tagId: "tag-complete",
          name: "GA4 - Config",
          type: "gaawc",
          firingTriggerId: ["trigger-all-pages"],
        }),
      ],
      triggers: [
        makeTrigger({ triggerId: "trigger-all-pages", name: "All Pages", type: "PAGEVIEW" }),
      ],
      variables: [
        makeVariable({
          variableId: "variable-const",
          name: "CONST - Measurement ID",
          type: "c",
          parameter: [{ type: "template", key: "value", value: "G-TEST123" }],
        }),
      ],
      builtInVariables: [makeBuiltInVariable({ name: "Page URL", type: "url" })],
      environments: [
        makeEnvironment({
          environmentId: "env-live",
          name: "Live",
          type: "live",
          url: "https://example.com",
        }),
      ],
      clients: [makeClient({ clientId: "client-1", name: "GA4 Client", type: "ga4" })],
      transformations: [
        makeTransformation({
          transformationId: "transform-1",
          name: "Hash Email",
          type: "sha256",
        }),
      ],
    };

    setWorkspaceState(state);
    const result = await takeSnapshot(file, {
      versionId: "200",
      publishedAt: "2026-03-18T12:00:00.000Z",
    });

    const snapshot = JSON.parse(readFileSync(file, "utf-8")) as Record<string, unknown>;
    const expectedResources = JSON.parse(JSON.stringify(state)) as Record<string, unknown>;

    expect(result).toMatchObject({
      tagCount: 1,
      triggerCount: 1,
      variableCount: 1,
      folderCount: 1,
      builtInVariableCount: 1,
      environmentCount: 1,
      clientCount: 1,
      transformationCount: 1,
    });
    expect(snapshot).toMatchObject({
      schemaVersion: "1.0",
      meta: {
        accountId: CONFIG.accountId,
        containerId: CONFIG.containerId,
        workspaceId: CONFIG.workspaceId,
        versionId: "200",
        publishedAt: "2026-03-18T12:00:00.000Z",
      },
      tags: expectedResources.tags,
      triggers: expectedResources.triggers,
      variables: expectedResources.variables,
      folders: expectedResources.folders,
      builtInVariables: expectedResources.builtInVariables,
      environments: expectedResources.environments,
      clients: expectedResources.clients,
      transformations: expectedResources.transformations,
    });
  });
});
