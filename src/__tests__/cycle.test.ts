import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { restoreWorkspace } from "../tools/restore.js";
import * as gtmCli from "../lib/gtm-cli.js";
import { writeFileSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";

// Mock the GTM CLI bridge
vi.mock("../lib/gtm-cli.js", () => ({
  listTags: vi.fn(),
  listTriggers: vi.fn(),
  listVariables: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  createTrigger: vi.fn(),
  deleteTrigger: vi.fn(),
  createVariable: vi.fn(),
  deleteVariable: vi.fn(),
  getWorkspacePath: vi.fn(() => "accounts/123/containers/456/workspaces/789"),
  buildHtmlTagConfig: vi.fn(),
  BUILTIN_TRIGGER_IDS: new Set(),
}));

// Mock architecture to provide BUILTIN_TRIGGER_IDS
vi.mock("../lib/architecture.js", () => ({
  BUILTIN_TRIGGER_IDS: new Set(),
}));

describe("GTM Cycle Integration Test (Snapshot → Mutate → Restore)", () => {
  const SNAPSHOT_PATH = resolve("/tmp/test-cycle-snapshot.json");

  const originalTags = [
    {
      tagId: "1",
      name: "GA4 - Pageview",
      type: "gaawc",
      fingerprint: "fp1",
      firingTriggerId: ["100"],
    },
  ];
  const originalTriggers = [
    { triggerId: "100", name: "All Pages", type: "PAGEVIEW", fingerprint: "fp2" },
  ];
  const originalVariables = [
    {
      variableId: "200",
      name: "GA4 Measurement ID",
      type: "c",
      fingerprint: "fp3",
      parameter: [{ type: "template", key: "value", value: "G-ABC123" }],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    if (existsSync(SNAPSHOT_PATH)) unlinkSync(SNAPSHOT_PATH);
  });

  it("should detect and restore a deleted tag from a snapshot file", async () => {
    // 1. Write a pre-built snapshot to disk (no API call needed for this step)
    const snapshotContent = {
      schemaVersion: "1.0",
      meta: {
        timestamp: new Date().toISOString(),
        accountId: "123",
        containerId: "456",
        workspaceId: "789",
        description: "Cycle test snapshot",
      },
      tags: originalTags,
      triggers: originalTriggers,
      variables: originalVariables,
    };
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshotContent, null, 2));

    // 2. Mutate state — tag has been deleted, trigger still exists, variable still exists
    (gtmCli.listTags as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (gtmCli.listTriggers as ReturnType<typeof vi.fn>).mockResolvedValue([...originalTriggers]);
    (gtmCli.listVariables as ReturnType<typeof vi.fn>).mockResolvedValue([...originalVariables]);
    (gtmCli.createTag as ReturnType<typeof vi.fn>).mockResolvedValue(
      JSON.stringify({ tagId: "new-1", name: "GA4 - Pageview" }),
    );

    // 3. Restore from snapshot
    const result = await restoreWorkspace(SNAPSHOT_PATH, { dryRun: false, allowDelete: false });

    // 4. Verify: tag was recreated, trigger and variable were skipped
    expect(gtmCli.createTag).toHaveBeenCalledWith(
      expect.objectContaining({ name: "GA4 - Pageview" }),
    );
    expect(result.summary.created).toBe(1); // The missing tag
    expect(result.summary.skipped).toBe(2); // Trigger and variable already exist
    expect(result.summary.failed).toBe(0);
  });

  it("dry-run should show would-create without calling createTag", async () => {
    const snapshotContent = {
      schemaVersion: "1.0",
      meta: { timestamp: new Date().toISOString(), workspaceId: "789" },
      tags: originalTags,
      triggers: [],
      variables: [],
    };
    writeFileSync(SNAPSHOT_PATH, JSON.stringify(snapshotContent, null, 2));

    (gtmCli.listTags as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (gtmCli.listTriggers as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (gtmCli.listVariables as ReturnType<typeof vi.fn>).mockResolvedValue([]);

    const result = await restoreWorkspace(SNAPSHOT_PATH, { dryRun: true, allowDelete: false });

    expect(gtmCli.createTag).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    expect(result.summary.created).toBe(1);
    const tagAction = result.actions.find((a) => a.resourceType === "tag");
    expect(tagAction?.detail).toBe("Would create");
  });
});
