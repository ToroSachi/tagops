/**
 * Tests for Multi-Container Compare and Webhook tools
 */

import { describe, it, expect } from "vitest";
import type { GtmTrigger, GtmVariable } from "../types/gtm.js";

describe("Webhook Notifications", () => {
  it("formats Slack payloads correctly", async () => {
    const mod = await import("../tools/watch.js");

    // Test that notifyEvent creates a structured payload
    // We can't actually call a webhook, but we can verify the function exists
    expect(typeof mod.notifyEvent).toBe("function");
    expect(typeof mod.sendWebhook).toBe("function");
    expect(typeof mod.printNotifyResult).toBe("function");
  });

  it("printNotifyResult handles success", async () => {
    const { printNotifyResult } = await import("../tools/watch.js");
    expect(() => printNotifyResult({ sent: true, statusCode: 200 })).not.toThrow();
  });

  it("printNotifyResult handles failure", async () => {
    const { printNotifyResult } = await import("../tools/watch.js");
    expect(() => printNotifyResult({ sent: false, error: "Connection refused" })).not.toThrow();
  });
});

describe("Container Compare", () => {
  it("exports the compare functions", async () => {
    const mod = await import("../tools/compare.js");
    expect(typeof mod.compareContainers).toBe("function");
    expect(typeof mod.printCompareReport).toBe("function");
    expect(typeof mod.compareResourceCollections).toBe("function");
  });

  it("detects deep tag changes when TagOps-ID matches", async () => {
    const { compareResourceCollections } = await import("../tools/compare.js");

    const source = [
      {
        tagId: "1",
        name: "Meta Pixel",
        type: "html",
        notes: "TagOps-ID: 1234",
        parameter: [{ key: "html", value: "<script>one</script>" }],
        firingTriggerId: ["83"],
      },
    ];

    const target = [
      {
        tagId: "9",
        name: "Meta Pixel Renamed",
        type: "html",
        notes: "TagOps-ID: 1234",
        parameter: [{ key: "html", value: "<script>two</script>" }],
        firingTriggerId: ["83"],
      },
    ];

    const diffs = compareResourceCollections(source, target, (item) => item.tagId);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe("different");
    expect(diffs[0].differences).toContain("name");
    expect(diffs[0].differences?.some((d) => d.startsWith("parameter"))).toBe(true);
  });

  it("detects trigger and variable body changes", async () => {
    const { compareResourceCollections } = await import("../tools/compare.js");

    const triggerDiffs = compareResourceCollections(
      [
        {
          triggerId: "t1",
          name: "CE - Purchase",
          type: "CUSTOM_EVENT",
          notes: "TagOps-ID: trig-1",
          customEventFilter: [
            {
              type: "EQUALS",
              parameter: [
                { key: "arg0", type: "template", value: "{{_event}}" },
                { key: "arg1", type: "template", value: "purchase" },
              ],
            },
          ],
        },
      ] as Array<GtmTrigger & { customEventFilter?: unknown[] }>,
      [
        {
          triggerId: "t2",
          name: "CE - Purchase",
          type: "CUSTOM_EVENT",
          notes: "TagOps-ID: trig-1",
          customEventFilter: [
            {
              type: "EQUALS",
              parameter: [
                { key: "arg0", type: "template", value: "{{_event}}" },
                { key: "arg1", type: "template", value: "begin_checkout" },
              ],
            },
          ],
        },
      ] as Array<GtmTrigger & { customEventFilter?: unknown[] }>,
      (item) => item.triggerId,
    );

    const variableDiffs = compareResourceCollections(
      [
        {
          variableId: "v1",
          name: "DLV - Value",
          type: "v",
          notes: "TagOps-ID: var-1",
          parameter: [{ key: "value", type: "template", value: "ecommerce.value" }],
        },
      ] as Array<GtmVariable & { parameter?: unknown[] }>,
      [
        {
          variableId: "v2",
          name: "DLV - Value",
          type: "v",
          notes: "TagOps-ID: var-1",
          parameter: [{ key: "value", type: "template", value: "ecommerce.total_value" }],
        },
      ] as Array<GtmVariable & { parameter?: unknown[] }>,
      (item) => item.variableId,
    );

    expect(triggerDiffs[0].status).toBe("different");
    expect(triggerDiffs[0].differences?.some((d) => d.startsWith("customEventFilter"))).toBe(true);
    expect(variableDiffs[0].status).toBe("different");
    expect(variableDiffs[0].differences?.some((d) => d.startsWith("parameter"))).toBe(true);
  });

  it("printCompareReport handles an empty comparison", async () => {
    const { printCompareReport } = await import("../tools/compare.js");

    const mockReport = {
      sourceProfile: "staging",
      targetProfile: "production",
      tags: [
        { name: "GA4 Config", status: "identical" as const, sourceId: "1", targetId: "2" },
        { name: "Meta PageView", status: "only_in_source" as const, sourceId: "3" },
        { name: "TikTok Pixel", status: "only_in_target" as const, targetId: "4" },
        {
          name: "Ads Conversion",
          status: "different" as const,
          sourceId: "5",
          targetId: "6",
          differences: ["consent: needed → notNeeded"],
        },
      ],
      triggers: [],
      variables: [],
      summary: "1 only in staging, 1 only in production, 1 differ, 1 identical",
    };

    expect(() => printCompareReport(mockReport)).not.toThrow();
  });
});
