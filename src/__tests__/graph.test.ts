/**
 * Tests for the Graph Generator.
 */

import { describe, it, expect } from "vitest";
import { generateGraph } from "../tools/graph.js";
import { writeFileSync, existsSync, unlinkSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Graph Generator", () => {
  const snapshotPath = resolve("/tmp/test-graph-snap.json");
  const outputPath = resolve("/tmp/test-graph-output.md");

  it("generates a correct mermaid flowchart from a snapshot", async () => {
    const snap = {
      version: "1.0",
      timestamp: "2026-03-15T00:00:00Z",
      account: { accountId: "1", containerId: "2", workspaceId: "3" },
      tags: [
        {
          tagId: "1",
          name: "GA4 - Purchase",
          type: "gaawe",
          firingTriggerId: ["10"],
          parameter: [{ type: "template", key: "value", value: "{{DLV - Ecommerce Value}}" }],
        },
      ],
      triggers: [
        {
          triggerId: "10",
          name: "CE - Purchase",
          type: "CUSTOM_EVENT",
          customEventFilter: [
            {
              type: "EQUALS",
              parameter: [
                { type: "template", key: "arg0", value: "{{Event}}" },
                { type: "template", key: "arg1", value: "purchase" },
              ],
            },
          ],
        },
      ],
      variables: [
        { variableId: "100", name: "DLV - Ecommerce Value", type: "v" },
        { variableId: "101", name: "Event", type: "v" }, // Usually built-in, but testing var ref
      ],
    };

    writeFileSync(snapshotPath, JSON.stringify(snap));

    const report = await generateGraph({
      snapshot: snapshotPath,
      output: outputPath,
    });

    expect(report.source).toBe(snapshotPath);
    expect(report.nodeCount).toBeGreaterThan(0);
    expect(report.edgeCount).toBeGreaterThan(0);
    expect(existsSync(outputPath)).toBe(true);

    const md = readFileSync(outputPath, "utf-8");
    expect(md).toContain("flowchart LR");
    expect(md).toContain('tag_1["🏷️ GA4 - Purchase"]');
    expect(md).toContain("trig_10 --> |fires| tag_1");
    expect(md).toContain("var_100 -.-> |used in| tag_1");
    // Triggers also use variables
    expect(md).toContain("var_101 -.-> |evaluated| trig_10");

    unlinkSync(snapshotPath);
    unlinkSync(outputPath);
  });
});
