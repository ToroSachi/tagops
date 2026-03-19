import { describe, it, expect, vi, beforeEach } from "vitest";
import { scanForCleanup } from "../tools/cleanup.js";
import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

vi.mock("../lib/gtm-cli.js", () => ({
  listTags: vi.fn(),
  listTriggers: vi.fn(),
  listVariables: vi.fn(),
  deleteTag: vi.fn(),
  deleteTrigger: vi.fn(),
  deleteVariable: vi.fn(),
}));

describe("Cleanup Utility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("identifies unused variables", async () => {
    vi.mocked(listVariables).mockResolvedValue([
      { variableId: "1", name: "Used Var", type: "v" } as GtmVariable,
      { variableId: "2", name: "Unused Var", type: "v" } as GtmVariable,
      { variableId: "3", name: "Nested Var", type: "v" } as GtmVariable,
    ]);

    // Used Var is used in a tag
    vi.mocked(listTags).mockResolvedValue([
      {
        tagId: "100",
        name: "Tag 1",
        type: "html",
        parameter: [
          { type: "template", key: "html", value: "{{Used Var}}" },
          { type: "template", key: "html2", value: "{{Parent Var}}" },
        ],
      } as GtmTag,
    ]);

    // Nested Var is used in another variable, not directly in a tag
    vi.mocked(listVariables).mockResolvedValue([
      { variableId: "1", name: "Used Var", type: "v" } as GtmVariable,
      { variableId: "2", name: "Unused Var", type: "v" } as GtmVariable,
      { variableId: "3", name: "Nested Var", type: "v" } as GtmVariable,
      {
        variableId: "4",
        name: "Parent Var",
        type: "c",
        parameter: [{ type: "template", key: "value", value: "{{Nested Var}}" }],
      } as GtmVariable,
    ]);

    vi.mocked(listTriggers).mockResolvedValue([]);

    const report = await scanForCleanup();

    // Only "Unused Var" should be returned
    expect(report.unusedVariables).toHaveLength(1);
    expect(report.unusedVariables[0].name).toBe("Unused Var");
  });

  it("identifies orphaned triggers", async () => {
    vi.mocked(listVariables).mockResolvedValue([]);
    vi.mocked(listTags).mockResolvedValue([
      { tagId: "100", name: "Tag 1", type: "html", firingTriggerId: ["200"] } as GtmTag,
    ]);
    vi.mocked(listTriggers).mockResolvedValue([
      { triggerId: "200", name: "Used Trigger", type: "CUSTOM_EVENT" } as GtmTrigger,
      { triggerId: "300", name: "Orphaned Trigger", type: "CUSTOM_EVENT" } as GtmTrigger,
      { triggerId: "2147479553", name: "All Pages", type: "PAGEVIEW" } as GtmTrigger, // Built-in
    ]);

    const report = await scanForCleanup();
    expect(report.orphanedTriggers).toHaveLength(1);
    expect(report.orphanedTriggers[0].name).toBe("Orphaned Trigger");
  });

  it("identifies paused tags", async () => {
    vi.mocked(listVariables).mockResolvedValue([
      { variableId: "1", name: "Var", type: "v" } as GtmVariable,
    ]); // Need something so it doesn't throw empty workspace
    vi.mocked(listTags).mockResolvedValue([
      { tagId: "100", name: "Active Tag", type: "html", paused: false } as GtmTag,
      { tagId: "101", name: "Paused Tag", type: "html", paused: true } as GtmTag,
    ]);
    vi.mocked(listTriggers).mockResolvedValue([]);

    const report = await scanForCleanup();
    expect(report.pausedTags).toHaveLength(1);
    expect(report.pausedTags[0].name).toBe("Paused Tag");
  });

  it("handles empty workspace correctly", async () => {
    vi.mocked(listVariables).mockResolvedValue([]);
    vi.mocked(listTags).mockResolvedValue([]);
    vi.mocked(listTriggers).mockResolvedValue([]);

    await expect(scanForCleanup()).rejects.toThrow("Cannot connect to GTM");
  });
});
