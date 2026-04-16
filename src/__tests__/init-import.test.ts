/**
 * Tests for `tagops init --import`.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("../tools/snapshot.js", () => ({
  takeSnapshot: vi.fn(async () => ({
    path: "/tmp/gtm-snapshot.json",
    tagCount: 71,
    triggerCount: 32,
    variableCount: 69,
    folderCount: 3,
    builtInVariableCount: 10,
    clientCount: 0,
    environmentCount: 2,
    transformationCount: 0,
    sizeBytes: 123456,
    warning: undefined,
  })),
}));

vi.mock("../tools/consent-audit.js", () => ({
  auditConsentV2: vi.fn(async () => ({
    complianceScore: 76,
    totalTags: 71,
    nonCompliantTags: 0,
    notConfiguredTags: 11,
    compliantTags: 50,
    partiallyCompliantTags: 0,
    tagAudits: [],
  })),
  generateConsentMarkdownReport: vi.fn(() => "# Consent Mode v2 Compliance Report\n\n...fake..."),
}));

vi.mock("../lib/config.js", () => ({
  writeConfig: vi.fn(() => "/tmp/.gtmrc.json"),
}));

describe("init --import", () => {
  it("wires snapshot + consent audit into one narrative summary", async () => {
    const { runInitImport } = await import("../tools/init-import.js");
    const result = await runInitImport({
      accountId: "123",
      containerId: "456",
      workspaceId: "1",
    });

    expect(result.tagCount).toBe(71);
    expect(result.triggerCount).toBe(32);
    expect(result.variableCount).toBe(69);
    expect(result.consentScore).toBe(76);
    expect(result.notConfiguredTags).toBe(11);
    expect(result.totalAuditedTags).toBe(71);
    expect(result.configPath).toContain(".gtmrc.json");
    expect(result.snapshotPath).toContain("gtm-snapshot.json");
    expect(result.reportPath).toContain("consent-report-");
    expect(result.reportPath).toMatch(/consent-report-\d{4}-\d{2}-\d{2}\.md$/);
  });

  it("printInitImportResult does not throw for a healthy container", async () => {
    const { printInitImportResult } = await import("../tools/init-import.js");
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    expect(() =>
      printInitImportResult({
        configPath: "/tmp/.gtmrc.json",
        snapshotPath: "/tmp/gtm-snapshot.json",
        reportPath: "/tmp/consent-report.md",
        tagCount: 10,
        triggerCount: 5,
        variableCount: 5,
        folderCount: 1,
        consentScore: 100,
        nonCompliantTags: 0,
        notConfiguredTags: 0,
        totalAuditedTags: 10,
      }),
    ).not.toThrow();
    spy.mockRestore();
  });
});
