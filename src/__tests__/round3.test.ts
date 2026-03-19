/**
 * Tests for changelog, validate-datalayer, and publish features.
 */

import { describe, it, expect, vi } from "vitest";
import { writeFileSync, unlinkSync, existsSync } from "node:fs";
import { resolve } from "node:path";

// ═══════════════════════════════════════════════════════════
// CHANGELOG TESTS
// ═══════════════════════════════════════════════════════════

describe("Changelog Generator", () => {
  const snap1Path = resolve("/tmp/gtm-snap-old.json");
  const snap2Path = resolve("/tmp/gtm-snap-new.json");

  it("detects added tags between snapshots", async () => {
    const { generateChangelog } = await import("../tools/changelog.js");
    const oldSnap = {
      version: "1.0",
      timestamp: "2026-03-15T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [{ tagId: "1", name: "Old Tag", type: "html", fingerprint: "a" }],
      triggers: [],
      variables: [],
    };
    const newSnap = {
      version: "1.0",
      timestamp: "2026-03-16T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [
        { tagId: "1", name: "Old Tag", type: "html", fingerprint: "a" },
        { tagId: "2", name: "New Tag", type: "html", fingerprint: "b" },
      ],
      triggers: [],
      variables: [],
    };
    writeFileSync(snap1Path, JSON.stringify(oldSnap));
    writeFileSync(snap2Path, JSON.stringify(newSnap));

    const report = await generateChangelog({ from: snap1Path, to: snap2Path });
    expect(report.entries.some((e) => e.action === "added" && e.name === "New Tag")).toBe(true);
    expect(report.summary).toContain("added");
  });

  it("detects removed triggers", async () => {
    const { generateChangelog } = await import("../tools/changelog.js");
    const oldSnap = {
      version: "1.0",
      timestamp: "2026-03-15T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [],
      triggers: [
        { triggerId: "10", name: "Old Trigger", type: "CUSTOM_EVENT" },
        { triggerId: "11", name: "Deleted Trigger", type: "CUSTOM_EVENT" },
      ],
      variables: [],
    };
    const newSnap = {
      version: "1.0",
      timestamp: "2026-03-16T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [],
      triggers: [{ triggerId: "10", name: "Old Trigger", type: "CUSTOM_EVENT" }],
      variables: [],
    };
    writeFileSync(snap1Path, JSON.stringify(oldSnap));
    writeFileSync(snap2Path, JSON.stringify(newSnap));

    const report = await generateChangelog({ from: snap1Path, to: snap2Path });
    expect(report.entries.some((e) => e.action === "removed" && e.name === "Deleted Trigger")).toBe(
      true,
    );
  });

  it("detects paused tags", async () => {
    const { generateChangelog } = await import("../tools/changelog.js");
    const oldSnap = {
      version: "1.0",
      timestamp: "2026-03-15T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [{ tagId: "1", name: "My Tag", type: "html", fingerprint: "a", paused: false }],
      triggers: [],
      variables: [],
    };
    const newSnap = {
      version: "1.0",
      timestamp: "2026-03-16T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [{ tagId: "1", name: "My Tag", type: "html", fingerprint: "a", paused: true }],
      triggers: [],
      variables: [],
    };
    writeFileSync(snap1Path, JSON.stringify(oldSnap));
    writeFileSync(snap2Path, JSON.stringify(newSnap));

    const report = await generateChangelog({ from: snap1Path, to: snap2Path });
    expect(report.entries.some((e) => e.action === "paused")).toBe(true);
  });

  it("renders markdown output", async () => {
    const { generateChangelog, renderChangelogMarkdown } = await import("../tools/changelog.js");
    const oldSnap = {
      version: "1.0",
      timestamp: "2026-03-15T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [],
      triggers: [],
      variables: [{ variableId: "1", name: "New Var", type: "v" }],
    };
    const newSnap = {
      version: "1.0",
      timestamp: "2026-03-16T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [],
      triggers: [],
      variables: [],
    };
    writeFileSync(snap1Path, JSON.stringify(oldSnap));
    writeFileSync(snap2Path, JSON.stringify(newSnap));

    const report = await generateChangelog({ from: snap1Path, to: snap2Path });
    const md = renderChangelogMarkdown(report);
    expect(md).toContain("# GTM Changelog");
    expect(md).toContain("REMOVED");
    expect(md).toContain("New Var");
  });

  it("reports no changes for identical snapshots", async () => {
    const { generateChangelog } = await import("../tools/changelog.js");
    const snap = {
      version: "1.0",
      timestamp: "2026-03-15T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [{ tagId: "1", name: "Tag", type: "html", fingerprint: "a" }],
      triggers: [],
      variables: [],
    };
    writeFileSync(snap1Path, JSON.stringify(snap));
    writeFileSync(snap2Path, JSON.stringify(snap));

    const report = await generateChangelog({ from: snap1Path, to: snap2Path });
    expect(report.entries).toHaveLength(0);
    expect(report.summary).toBe("No changes");
  });

  // Cleanup
  it("cleanup temp files", () => {
    if (existsSync(snap1Path)) unlinkSync(snap1Path);
    if (existsSync(snap2Path)) unlinkSync(snap2Path);
  });
});

// ═══════════════════════════════════════════════════════════
// DATA LAYER VALIDATOR TESTS
// ═══════════════════════════════════════════════════════════

describe("Data Layer Validator", () => {
  it("passes validation for complete dataLayer events", async () => {
    const { validateDataLayer } = await import("../tools/validate-datalayer.js");
    const events = [
      { event: "page_view", page_title: "Home", page_location: "https://example.com" },
      {
        event: "view_item",
        ecommerce: { items: [{ item_id: "123" }], value: 29.99, currency: "USD" },
      },
      {
        event: "purchase",
        ecommerce: {
          transaction_id: "T-001",
          value: 99.99,
          currency: "USD",
          items: [{ item_id: "456" }],
        },
      },
    ];

    const result = validateDataLayer(events, [
      { event: "page_view", requiredKeys: ["event"] },
      { event: "view_item", requiredKeys: ["event", "ecommerce"] },
      { event: "purchase", requiredKeys: ["event", "ecommerce"] },
    ]);

    expect(result.passed).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  it("reports missing events", async () => {
    const { validateDataLayer } = await import("../tools/validate-datalayer.js");
    const events = [{ event: "page_view" }];

    const result = validateDataLayer(events, [
      { event: "page_view", requiredKeys: ["event"] },
      { event: "purchase", requiredKeys: ["event", "ecommerce"] },
    ]);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === "missing_event" && i.event === "purchase")).toBe(
      true,
    );
  });

  it("reports missing required keys", async () => {
    const { validateDataLayer } = await import("../tools/validate-datalayer.js");
    const events = [{ event: "purchase" }]; // Missing "ecommerce"

    const result = validateDataLayer(events, [
      { event: "purchase", requiredKeys: ["event", "ecommerce"] },
    ]);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === "missing_key" && i.key === "ecommerce")).toBe(true);
  });

  it("reports empty values", async () => {
    const { validateDataLayer } = await import("../tools/validate-datalayer.js");
    const events = [{ event: "purchase", ecommerce: null }];

    const result = validateDataLayer(events, [
      { event: "purchase", requiredKeys: ["event", "ecommerce"] },
    ]);

    expect(result.passed).toBe(false);
    expect(result.issues.some((i) => i.type === "empty_value")).toBe(true);
  });

  it("validates from a JSON file", async () => {
    const { validateFromFile } = await import("../tools/validate-datalayer.js");
    const filePath = "/tmp/test-datalayer.json";
    const events = [
      { event: "page_view" },
      { event: "purchase", ecommerce: { transaction_id: "T-001", value: 50 } },
    ];
    writeFileSync(filePath, JSON.stringify(events));

    const result = validateFromFile(filePath, [
      { event: "page_view", requiredKeys: ["event"] },
      { event: "purchase", requiredKeys: ["event", "ecommerce"] },
    ]);

    expect(result.passed).toBe(true);
    expect(result.source).toBe(filePath);

    if (existsSync(filePath)) unlinkSync(filePath);
  });

  it("generates a capture script", async () => {
    const { generateCaptureScript } = await import("../tools/validate-datalayer.js");
    const script = generateCaptureScript();
    expect(script).toContain("window.__dlCapture");
    expect(script).toContain("dataLayer.push");
  });

  it("STANDARD_SCHEMAS has expected events", async () => {
    const { STANDARD_SCHEMAS } = await import("../tools/validate-datalayer.js");
    const events = STANDARD_SCHEMAS.map((s) => s.event);
    expect(events).toContain("page_view");
    expect(events).toContain("view_item");
    expect(events).toContain("add_to_cart");
    expect(events).toContain("purchase");
    expect(events).toContain("begin_checkout");
  });
});

// ═══════════════════════════════════════════════════════════
// PUBLISH TESTS
// ═══════════════════════════════════════════════════════════

describe("Publish Tool", () => {
  it("dry-run returns correct result without calling GTM", async () => {
    const { runPublish } = await import("../tools/publish.js");
    const result = await runPublish({
      name: "v1.5 — Test Release",
      description: "Testing dry run",
      dryRun: true,
    });

    expect(result.dryRun).toBe(true);
    expect(result.versionName).toBe("v1.5 — Test Release");
    expect(result.versionDescription).toBe("Testing dry run");
    expect(result.published).toBe(false);
    expect(result.versionId).toBeUndefined();
  });

  it("rejects empty version name", async () => {
    const { runPublish } = await import("../tools/publish.js");
    const result = await runPublish({ name: "" });
    expect(result.error).toContain("required");
  });
});
