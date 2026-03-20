import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { existsSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { restoreWorkspace } from "../tools/restore.js";
import * as gtmCli from "../lib/gtm-cli.js";

vi.mock("../lib/gtm-cli.js", () => ({
  buildCompleteTagConfig: vi.fn((tag: object, overrides: Record<string, unknown> = {}) => ({
    ...(structuredClone(tag) as Record<string, unknown>),
    ...overrides,
  })),
  listFolders: vi.fn(),
  listTags: vi.fn(),
  listTriggers: vi.fn(),
  listVariables: vi.fn(),
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
}));

vi.mock("../lib/architecture.js", () => ({
  BUILTIN_TRIGGER_IDS: new Set<string>(),
}));

vi.mock("../lib/permission-guard.js", () => ({
  requireWriteAccess: vi.fn(),
  requirePublishAccess: vi.fn(),
}));

const SNAPSHOT_PATH = resolve("/tmp/tagops-restore-test.json");
const tagOps = (id: string) => `TagOps-ID: ${id}`;

function makeSnapshot(payload: Record<string, unknown>) {
  writeFileSync(
    SNAPSHOT_PATH,
    JSON.stringify(
      {
        schemaVersion: "1.0",
        meta: { timestamp: new Date().toISOString(), workspaceId: "789" },
        ...payload,
      },
      null,
      2,
    ),
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(gtmCli.listFolders).mockResolvedValue([]);
});

afterEach(() => {
  if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH);
});

describe("restoreWorkspace", () => {
  it("updates matched logical resources and preserves full firing trigger arrays", async () => {
    makeSnapshot({
      tags: [
        {
          tagId: "snap-tag-1",
          name: "Meta - Purchase",
          type: "html",
          fingerprint: "snap-tag-fp",
          notes: tagOps("tag-1"),
          parameter: [{ type: "template", key: "html", value: "<script>purchase</script>" }],
          firingTriggerId: ["snap-trigger-a", "snap-trigger-b"],
          blockingTriggerId: ["snap-trigger-c"],
          consentSettings: {
            consentStatus: "needed",
            consentType: { type: "list", list: [{ type: "template", value: "ad_storage" }] },
          },
        },
      ],
      triggers: [
        {
          triggerId: "snap-trigger-a",
          name: "CE - Purchase",
          type: "CUSTOM_EVENT",
          fingerprint: "snap-trig-a",
          notes: tagOps("trigger-a"),
          customEventFilter: [],
        },
        {
          triggerId: "snap-trigger-b",
          name: "CE - Checkout",
          type: "CUSTOM_EVENT",
          fingerprint: "snap-trig-b",
          notes: tagOps("trigger-b"),
          customEventFilter: [],
        },
        {
          triggerId: "snap-trigger-c",
          name: "Exception - Internal",
          type: "PAGEVIEW",
          fingerprint: "snap-trig-c",
          notes: tagOps("trigger-c"),
        },
      ],
      variables: [
        {
          variableId: "snap-var-1",
          name: "DLV - Ecommerce Value",
          type: "v",
          fingerprint: "snap-var-fp",
          notes: tagOps("var-1"),
          parameter: [{ type: "template", key: "value", value: "ecommerce.value" }],
        },
      ],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([
      {
        tagId: "live-tag-9",
        name: "Meta - Purchase",
        type: "html",
        fingerprint: "live-tag-fp",
        notes: tagOps("tag-1"),
        parameter: [{ type: "template", key: "html", value: "<script>old</script>" }],
        firingTriggerId: ["live-trigger-a"],
        blockingTriggerId: [],
        consentSettings: {
          consentStatus: "needed",
          consentType: { type: "list", list: [{ type: "template", value: "analytics_storage" }] },
        },
      } as any,
    ]);

    vi.mocked(gtmCli.listTriggers).mockResolvedValue([
      {
        triggerId: "live-trigger-a",
        name: "CE - Purchase",
        type: "CUSTOM_EVENT",
        fingerprint: "live-trig-a",
        notes: tagOps("trigger-a"),
        customEventFilter: [
          { type: "EQUALS", parameter: [{ type: "template", value: "{{_event}}" }] },
        ],
      } as any,
      {
        triggerId: "live-trigger-b",
        name: "CE - Checkout",
        type: "CUSTOM_EVENT",
        fingerprint: "live-trig-b",
        notes: tagOps("trigger-b"),
        customEventFilter: [
          { type: "EQUALS", parameter: [{ type: "template", value: "{{_event}}" }] },
        ],
      } as any,
      {
        triggerId: "live-trigger-c",
        name: "Exception - Internal",
        type: "PAGEVIEW",
        fingerprint: "live-trig-c",
        notes: tagOps("trigger-c"),
      } as any,
    ]);

    vi.mocked(gtmCli.listVariables).mockResolvedValue([
      {
        variableId: "live-var-9",
        name: "DLV - Ecommerce Value",
        type: "v",
        fingerprint: "live-var-fp",
        notes: tagOps("var-1"),
        parameter: [{ type: "template", key: "value", value: "ecommerce.old_value" }],
      } as any,
    ]);

    vi.mocked(gtmCli.updateTag).mockResolvedValue(JSON.stringify({ ok: true }));
    vi.mocked(gtmCli.updateTrigger).mockResolvedValue({} as never);
    vi.mocked(gtmCli.updateVariable).mockResolvedValue({} as never);

    const result = await restoreWorkspace(SNAPSHOT_PATH, { dryRun: false, allowDelete: false });

    expect(gtmCli.updateTrigger).toHaveBeenCalledTimes(2);
    expect(gtmCli.updateVariable).toHaveBeenCalledTimes(1);
    expect(gtmCli.updateTag).toHaveBeenCalledTimes(1);
    expect(gtmCli.createTag).not.toHaveBeenCalled();

    expect(gtmCli.updateTag).toHaveBeenCalledWith(
      expect.objectContaining({
        tagId: "live-tag-9",
        firingTriggerId: ["live-trigger-a", "live-trigger-b"],
        config: expect.objectContaining({
          firingTriggerId: ["live-trigger-a", "live-trigger-b"],
          blockingTriggerId: ["live-trigger-c"],
        }),
      }),
    );

    expect(result.summary.created).toBe(0);
    expect(result.summary.updated).toBe(4);
    expect(result.summary.failed).toBe(0);
  });

  it("creates folders before child resources and remaps parentFolderId", async () => {
    makeSnapshot({
      tags: [],
      triggers: [],
      variables: [
        {
          variableId: "snap-var-1",
          name: "CONST - Folder Scoped",
          type: "c",
          fingerprint: "snap-var-fp",
          parentFolderId: "snap-folder-1",
          parameter: [{ type: "template", key: "value", value: "folder-value" }],
        },
      ],
      folders: [
        {
          folderId: "snap-folder-1",
          name: "Marketing",
          fingerprint: "snap-folder-fp",
          path: "accounts/1/containers/2/workspaces/3/folders/snap-folder-1",
        },
      ],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([
      {
        tagId: "live-tag-sentinel",
        name: "Sentinel",
        type: "html",
        fingerprint: "live-tag-sentinel-fp",
      } as never,
    ]);
    vi.mocked(gtmCli.listTriggers).mockResolvedValue([]);
    vi.mocked(gtmCli.listVariables).mockResolvedValue([]);
    vi.mocked(gtmCli.listFolders).mockResolvedValue([]);

    vi.mocked(gtmCli.createFolder).mockResolvedValue({
      folderId: "live-folder-9",
      name: "Marketing",
      fingerprint: "live-folder-fp",
      path: "accounts/1/containers/2/workspaces/3/folders/live-folder-9",
    } as any);
    vi.mocked(gtmCli.createVariable).mockResolvedValue({ variableId: "live-var-9" } as never);

    const result = await restoreWorkspace(SNAPSHOT_PATH, { dryRun: false, allowDelete: false });

    expect(gtmCli.createFolder).toHaveBeenCalledWith("Marketing", expect.any(Object));
    expect(gtmCli.createVariable).toHaveBeenCalledWith(
      "CONST - Folder Scoped",
      "c",
      expect.objectContaining({ parentFolderId: "live-folder-9" }),
    );
    const createFolderMock = gtmCli.createFolder as unknown as {
      mock: { invocationCallOrder: number[] };
    };
    const createVariableMock = gtmCli.createVariable as unknown as {
      mock: { invocationCallOrder: number[] };
    };
    expect(createFolderMock.mock.invocationCallOrder[0]).toBeLessThan(
      createVariableMock.mock.invocationCallOrder[0],
    );
    expect(result.folderOperations.created).toBe(1);
    expect(result.summary.created).toBe(2);
  });

  it("deletes only unmatched logical resources when allowDelete is enabled", async () => {
    makeSnapshot({
      tags: [
        {
          tagId: "snap-tag-1",
          name: "GA4 - Page View",
          type: "gaawc",
          fingerprint: "snap-tag-fp",
          notes: tagOps("tag-keep"),
          firingTriggerId: ["snap-trigger-1"],
        },
      ],
      triggers: [
        {
          triggerId: "snap-trigger-1",
          name: "All Pages",
          type: "PAGEVIEW",
          fingerprint: "snap-trig-fp",
          notes: tagOps("trigger-keep"),
        },
      ],
      variables: [
        {
          variableId: "snap-var-1",
          name: "CONST - Site ID",
          type: "c",
          fingerprint: "snap-var-fp",
          notes: tagOps("var-keep"),
          parameter: [{ type: "template", key: "value", value: "site-1" }],
        },
      ],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([
      {
        tagId: "live-tag-keep",
        name: "GA4 - Page View",
        type: "gaawc",
        fingerprint: "live-tag-fp",
        notes: tagOps("tag-keep"),
        firingTriggerId: ["live-trigger-keep"],
      } as any,
      {
        tagId: "live-tag-delete",
        name: "Orphan Tag",
        type: "html",
        fingerprint: "live-tag-delete-fp",
      } as any,
    ]);

    vi.mocked(gtmCli.listTriggers).mockResolvedValue([
      {
        triggerId: "live-trigger-keep",
        name: "All Pages",
        type: "PAGEVIEW",
        fingerprint: "live-trig-fp",
        notes: tagOps("trigger-keep"),
      } as any,
      {
        triggerId: "live-trigger-delete",
        name: "Orphan Trigger",
        type: "CUSTOM_EVENT",
        fingerprint: "live-trig-delete-fp",
      } as any,
    ]);

    vi.mocked(gtmCli.listVariables).mockResolvedValue([
      {
        variableId: "live-var-keep",
        name: "CONST - Site ID",
        type: "c",
        fingerprint: "live-var-fp",
        notes: tagOps("var-keep"),
        parameter: [{ type: "template", key: "value", value: "site-1" }],
      } as any,
      {
        variableId: "live-var-delete",
        name: "Orphan Var",
        type: "c",
        fingerprint: "live-var-delete-fp",
      } as any,
    ]);

    vi.mocked(gtmCli.updateTag).mockResolvedValue(JSON.stringify({ ok: true }));
    vi.mocked(gtmCli.updateTrigger).mockResolvedValue({} as never);
    vi.mocked(gtmCli.updateVariable).mockResolvedValue({} as never);
    vi.mocked(gtmCli.deleteTag).mockResolvedValue(true);
    vi.mocked(gtmCli.deleteTrigger).mockResolvedValue(true);
    vi.mocked(gtmCli.deleteVariable).mockResolvedValue(true);

    const result = await restoreWorkspace(SNAPSHOT_PATH, { dryRun: false, allowDelete: true });

    expect(gtmCli.deleteTag).toHaveBeenCalledTimes(1);
    expect(gtmCli.deleteTrigger).toHaveBeenCalledTimes(1);
    expect(gtmCli.deleteVariable).toHaveBeenCalledTimes(1);
    expect(gtmCli.deleteTag).toHaveBeenCalledWith("live-tag-delete");
    expect(gtmCli.deleteTrigger).toHaveBeenCalledWith("live-trigger-delete");
    expect(gtmCli.deleteVariable).toHaveBeenCalledWith("live-var-delete");

    expect(result.summary.deleted).toBe(3);
    expect(result.summary.failed).toBe(0);
  });
});
