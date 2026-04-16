import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GtmFolder, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";
import { plan } from "../tools/plan.js";
import * as gtmCli from "../lib/gtm-cli.js";

vi.mock("../lib/gtm-cli.js", () => ({
  listFolders: vi.fn(),
  listTags: vi.fn(),
  listTriggers: vi.fn(),
  listVariables: vi.fn(),
}));

vi.mock("../lib/architecture.js", () => ({
  BUILTIN_TRIGGER_IDS: new Set<string>(["2147479553"]),
}));

const TEMP_DIR = join(tmpdir(), "tagops-plan-tests");
const SNAPSHOT_PATH = join(TEMP_DIR, "snapshot.json");

function makeTag(overrides: Partial<GtmTag> = {}): GtmTag {
  return {
    tagId: "tag-1",
    name: "Meta Pixel",
    type: "html",
    fingerprint: "tag-fp-1",
    parameter: [],
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<GtmTrigger> = {}): GtmTrigger {
  return {
    triggerId: "trigger-1",
    name: "Purchase Trigger",
    type: "CUSTOM_EVENT",
    fingerprint: "trigger-fp-1",
    customEventFilter: [],
    ...overrides,
  };
}

function makeVariable(overrides: Partial<GtmVariable> = {}): GtmVariable {
  return {
    variableId: "variable-1",
    name: "DLV - Value",
    type: "v",
    fingerprint: "variable-fp-1",
    parameter: [],
    ...overrides,
  };
}

function makeFolder(overrides: Partial<GtmFolder> = {}): GtmFolder {
  return {
    folderId: "folder-1",
    name: "Core Tags",
    path: "accounts/1/containers/2/workspaces/3/folders/folder-1",
    fingerprint: "folder-fp-1",
    ...overrides,
  };
}

function writeSnapshot(payload: {
  tags?: GtmTag[];
  triggers?: GtmTrigger[];
  variables?: GtmVariable[];
  folders?: GtmFolder[];
}): string {
  writeFileSync(
    SNAPSHOT_PATH,
    JSON.stringify(
      {
        schemaVersion: "1.0",
        meta: {
          timestamp: "2026-03-19T00:00:00.000Z",
        },
        tags: [],
        triggers: [],
        variables: [],
        folders: [],
        ...payload,
      },
      null,
      2,
    ),
  );

  return SNAPSHOT_PATH;
}

beforeEach(() => {
  mkdirSync(TEMP_DIR, { recursive: true });
  vi.clearAllMocks();
  vi.mocked(gtmCli.listTags).mockResolvedValue([]);
  vi.mocked(gtmCli.listTriggers).mockResolvedValue([]);
  vi.mocked(gtmCli.listVariables).mockResolvedValue([]);
  vi.mocked(gtmCli.listFolders).mockResolvedValue([]);
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe("plan", () => {
  it("plans creates for an empty workspace", async () => {
    const snapshotPath = writeSnapshot({
      tags: [makeTag({ firingTriggerId: ["trigger-1"] })],
      triggers: [makeTrigger()],
      variables: [makeVariable()],
      folders: [makeFolder()],
    });

    const result = await plan(snapshotPath);

    expect(result.actions).toHaveLength(4);
    expect(result.actions.every((action) => action.action === "create")).toBe(true);
    expect(result.actions.map((action) => action.resourceType)).toEqual([
      "folder",
      "trigger",
      "variable",
      "tag",
    ]);
    expect(result.resourceCounts.total).toMatchObject({
      current: 0,
      snapshot: 4,
      create: 4,
      update: 0,
      delete: 0,
      unchanged: 0,
    });
    expect(result.safetyWarnings).toEqual([]);
    expect(result.riskLevel).toBe("low");
  });

  it("returns no actions when the workspace matches the snapshot", async () => {
    const tag = makeTag({
      name: "GA4 - Purchase",
      tagId: "tag-77",
      firingTriggerId: ["trigger-77"],
      notes: "TagOps-ID: 11111111-1111-1111-1111-111111111111",
    });
    const trigger = makeTrigger({
      triggerId: "trigger-77",
      name: "CE - Purchase",
      notes: "TagOps-ID: 22222222-2222-2222-2222-222222222222",
    });
    const variable = makeVariable({
      variableId: "variable-77",
      name: "DLV - Ecommerce Value",
      notes: "TagOps-ID: 33333333-3333-3333-3333-333333333333",
      parameter: [{ type: "template", key: "name", value: "ecommerce.value" }],
    });
    const folder = makeFolder({ folderId: "folder-77", name: "Measurement" });
    const snapshotPath = writeSnapshot({
      tags: [tag],
      triggers: [trigger],
      variables: [variable],
      folders: [folder],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([tag]);
    vi.mocked(gtmCli.listTriggers).mockResolvedValue([trigger]);
    vi.mocked(gtmCli.listVariables).mockResolvedValue([variable]);
    vi.mocked(gtmCli.listFolders).mockResolvedValue([folder]);

    const result = await plan(snapshotPath);

    expect(result.actions).toEqual([]);
    expect(result.resourceCounts.tags.unchanged).toBe(1);
    expect(result.resourceCounts.triggers.unchanged).toBe(1);
    expect(result.resourceCounts.variables.unchanged).toBe(1);
    expect(result.resourceCounts.folders.unchanged).toBe(1);
    expect(result.resourceCounts.total.unchanged).toBe(4);
    expect(result.safetyWarnings).toEqual([]);
    expect(result.riskLevel).toBe("low");
  });

  it("marks the plan as critical when more than half of live resources would be deleted", async () => {
    const keepTag = makeTag({ tagId: "tag-keep", name: "Keep Tag" });
    const snapshotPath = writeSnapshot({
      tags: [keepTag],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([
      keepTag,
      makeTag({ tagId: "tag-delete", name: "Delete Tag" }),
    ]);
    vi.mocked(gtmCli.listTriggers).mockResolvedValue([
      makeTrigger({ triggerId: "trigger-delete", name: "Delete Trigger" }),
    ]);
    vi.mocked(gtmCli.listVariables).mockResolvedValue([
      makeVariable({ variableId: "variable-delete", name: "Delete Variable" }),
    ]);

    const result = await plan(snapshotPath);

    expect(result.actions.filter((action) => action.action === "delete")).toHaveLength(3);
    expect(result.safetyWarnings).toContain("Deletes 3 of 4 live resources (75%).");
    expect(result.riskLevel).toBe("critical");
  });

  it("warns when consent settings change", async () => {
    const currentTag = makeTag({
      tagId: "tag-consent",
      name: "GA4 - Config",
      consentSettings: {
        consentStatus: "needed",
        consentType: {
          type: "list",
          list: [{ type: "template", value: "analytics_storage" }],
        },
      },
    });
    const snapshotTag = makeTag({
      ...currentTag,
      consentSettings: {
        consentStatus: "notNeeded",
      },
    });
    const snapshotPath = writeSnapshot({
      tags: [snapshotTag],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([currentTag]);

    const result = await plan(snapshotPath);

    expect(result.actions).toEqual([
      expect.objectContaining({
        action: "update",
        resourceType: "tag",
        id: "tag-consent",
        name: "GA4 - Config",
        changes: ["consentSettings"],
      }),
    ]);
    expect(result.safetyWarnings).toContain("Modifies consent settings on 1 tag(s): GA4 - Config.");
    expect(result.riskLevel).toBe("high");
  });

  it("warns when deleting triggers still referenced by live tags", async () => {
    const currentTag = makeTag({
      tagId: "tag-live",
      name: "Meta Pixel",
      firingTriggerId: ["trigger-live"],
    });
    const snapshotPath = writeSnapshot({
      tags: [makeTag({ ...currentTag })],
      triggers: [],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([currentTag]);
    vi.mocked(gtmCli.listTriggers).mockResolvedValue([
      makeTrigger({ triggerId: "trigger-live", name: "Purchase Trigger" }),
    ]);

    const result = await plan(snapshotPath);

    expect(result.actions).toEqual([
      expect.objectContaining({
        action: "delete",
        resourceType: "trigger",
        id: "trigger-live",
        name: "Purchase Trigger",
      }),
    ]);
    expect(result.safetyWarnings).toContain(
      "Removes trigger(s) still referenced by live tags: Purchase Trigger -> Meta Pixel.",
    );
    expect(result.riskLevel).toBe("high");
  });
});
