import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";
import { detectDrift } from "../tools/drift.js";
import * as gtmCli from "../lib/gtm-cli.js";

vi.mock("../lib/gtm-cli.js", () => ({
  listTags: vi.fn(),
  listTriggers: vi.fn(),
  listVariables: vi.fn(),
}));

const TEMP_DIR = join(tmpdir(), "tagops-drift-tests");
const SNAPSHOT_PATH = join(TEMP_DIR, "snapshot.json");

type DriftTag = GtmTag & { path?: string; tagManagerUrl?: string };

function makeTag(overrides: Partial<DriftTag> = {}): DriftTag {
  return {
    tagId: "tag-1",
    name: "Meta Pixel",
    type: "html",
    fingerprint: "tag-fp-1",
    parameter: [{ type: "template", key: "html", value: "<script>one</script>" }],
    ...overrides,
  };
}

function makeTrigger(overrides: Partial<GtmTrigger> = {}): GtmTrigger {
  return {
    triggerId: "trigger-1",
    name: "CE - Purchase",
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
    parameter: [{ type: "template", key: "name", value: "ecommerce.value" }],
    ...overrides,
  };
}

function writeSnapshot(payload: {
  tags?: GtmTag[];
  triggers?: GtmTrigger[];
  variables?: GtmVariable[];
}): string {
  writeFileSync(
    SNAPSHOT_PATH,
    JSON.stringify(
      {
        schemaVersion: "1.0",
        meta: {
          timestamp: "2026-03-19T00:00:00.000Z",
          description: "Drift baseline",
        },
        tags: [],
        triggers: [],
        variables: [],
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
});

afterEach(() => {
  rmSync(TEMP_DIR, { recursive: true, force: true });
});

describe("detectDrift", () => {
  it("returns a clean report when the workspace matches the snapshot", async () => {
    const tag = makeTag({
      tagId: "tag-clean",
      name: "GA4 - Config",
      notes: "TagOps-ID: managed-tag-1",
    });
    const snapshotPath = writeSnapshot({ tags: [tag] });

    vi.mocked(gtmCli.listTags).mockResolvedValue([tag]);

    const report = await detectDrift(snapshotPath);

    expect(report.summary.totalChanges).toBe(0);
    expect(report.driftedResources).toEqual([]);
    expect(report.deletedResources).toEqual([]);
    expect(report.unmanagedResources).toEqual([]);
  });

  it("detects semantic drift when a tag parameter changes", async () => {
    const snapshotPath = writeSnapshot({
      tags: [
        makeTag({
          tagId: "tag-param",
          name: "Meta Pixel",
          notes: "TagOps-ID: managed-tag-2",
        }),
      ],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([
      makeTag({
        tagId: "tag-param",
        name: "Meta Pixel",
        notes: "TagOps-ID: managed-tag-2",
        parameter: [{ type: "template", key: "html", value: "<script>two</script>" }],
      }),
    ]);

    const report = await detectDrift(snapshotPath);

    expect(report.summary.totalChanges).toBe(1);
    expect(report.summary.driftedFields).toBeGreaterThan(0);
    expect(
      report.driftedResources.some(
        (entry) =>
          entry.name === "Meta Pixel" &&
          entry.classification === "managed" &&
          entry.field.startsWith("parameter"),
      ),
    ).toBe(true);
  });

  it("reports resources deleted from the live workspace", async () => {
    const tag = makeTag({ tagId: "tag-keep", name: "Keep Tag" });
    const variable = makeVariable({
      variableId: "variable-delete",
      name: "Deleted Variable",
      notes: "TagOps-ID: managed-variable-1",
    });
    const snapshotPath = writeSnapshot({
      tags: [tag],
      variables: [variable],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([tag]);

    const report = await detectDrift(snapshotPath);

    expect(report.deletedResources).toEqual([
      expect.objectContaining({
        name: "Deleted Variable",
        type: "variable",
        classification: "managed",
        id: "variable-delete",
      }),
    ]);
    expect(report.summary.deletedResources).toBe(1);
    expect(report.summary.totalChanges).toBe(1);
  });

  it("distinguishes managed and unmanaged drift", async () => {
    const snapshotPath = writeSnapshot({
      tags: [
        makeTag({
          tagId: "tag-managed",
          name: "GA4 - Purchase",
          notes: "TagOps-ID: managed-tag-3",
          parameter: [{ type: "template", key: "eventName", value: "purchase" }],
        }),
      ],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([
      makeTag({
        tagId: "tag-managed",
        name: "GA4 - Purchase",
        notes: "TagOps-ID: managed-tag-3",
        parameter: [{ type: "template", key: "eventName", value: "begin_checkout" }],
      }),
    ]);
    vi.mocked(gtmCli.listTriggers).mockResolvedValue([
      makeTrigger({
        triggerId: "trigger-unmanaged",
        name: "Manual Trigger",
      }),
    ]);

    const report = await detectDrift(snapshotPath);

    expect(report.driftedResources.find((entry) => entry.name === "GA4 - Purchase")).toMatchObject({
      classification: "managed",
      changeType: "modified",
    });
    expect(report.unmanagedResources).toEqual([
      expect.objectContaining({
        name: "Manual Trigger",
        classification: "unmanaged",
        changeType: "added",
      }),
    ]);
    expect(report.summary.managedChanges).toBe(1);
    expect(report.summary.unmanagedChanges).toBe(1);
  });

  it("ignores volatile GTM fields like fingerprint and path", async () => {
    const snapshotPath = writeSnapshot({
      tags: [
        makeTag({
          tagId: "tag-stable",
          name: "Stable Tag",
          notes: "TagOps-ID: managed-tag-4",
          fingerprint: "snapshot-fingerprint",
          path: "accounts/1/containers/2/workspaces/3/tags/1",
          tagManagerUrl: "https://tagmanager.google.com/snapshot",
        }),
      ],
    });

    vi.mocked(gtmCli.listTags).mockResolvedValue([
      makeTag({
        tagId: "tag-stable",
        name: "Stable Tag",
        notes: "TagOps-ID: managed-tag-4",
        fingerprint: "live-fingerprint",
        path: "accounts/1/containers/2/workspaces/3/tags/999",
        tagManagerUrl: "https://tagmanager.google.com/live",
      }),
    ]);

    const report = await detectDrift(snapshotPath);

    expect(report.summary.totalChanges).toBe(0);
    expect(report.driftedResources).toEqual([]);
    expect(report.deletedResources).toEqual([]);
  });
});
