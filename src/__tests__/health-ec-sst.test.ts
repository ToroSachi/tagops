/**
 * Tests for Health Score, Enhanced Conversions, and SST Readiness
 */

import { describe, it, expect } from "vitest";
import type { GtmClient, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

// Reusable mock tag factory
function mockTag(overrides: Partial<GtmTag> = {}): GtmTag {
  return {
    tagId: "1",
    name: "Test Tag",
    type: "gaawe",
    fingerprint: "abc",
    firingTriggerId: ["100"],
    consentSettings: { consentStatus: "needed" },
    ...overrides,
  };
}

function mockTrigger(overrides: Partial<GtmTrigger> = {}): GtmTrigger {
  return { triggerId: "100", name: "Test Trigger", type: "PAGEVIEW", ...overrides };
}

function mockVariable(overrides: Partial<GtmVariable> = {}): GtmVariable {
  return { variableId: "1", name: "DLV - test", type: "v", ...overrides };
}

describe("Container Health Score", () => {
  it("exports calculateHealthScore and printHealthReport", async () => {
    const mod = await import("../tools/health-score.js");
    expect(typeof mod.calculateHealthScore).toBe("function");
    expect(typeof mod.printHealthReport).toBe("function");
  });

  it("calculates a perfect score for a well-configured container", async () => {
    const { calculateHealthScore } = await import("../tools/health-score.js");

    const tags = [
      mockTag({ tagId: "1", name: "GA4 - Config", type: "gaawc" }),
      mockTag({ tagId: "2", name: "GA4 - Purchase", type: "gaawe" }),
    ];
    const triggers = [mockTrigger({ triggerId: "100" })];
    const variables = [mockVariable({ variableId: "1", name: "DLV - ecommerce" })];

    const report = calculateHealthScore(tags, triggers, variables);

    expect(report.overallScore).toBeGreaterThanOrEqual(70);
    expect(report.grade).toMatch(/^[A-C]$/);
    expect(report.components).toHaveLength(11);
    expect(report.components.every((c) => c.score >= 0 && c.score <= 100)).toBe(true);
  });

  it("penalizes containers with custom HTML and no consent", async () => {
    const { calculateHealthScore } = await import("../tools/health-score.js");

    const tags = [
      mockTag({ tagId: "1", name: "bad script", type: "html", consentSettings: undefined }),
      mockTag({ tagId: "2", name: "another bad", type: "html", consentSettings: undefined }),
    ];

    const report = calculateHealthScore(tags, [], []);
    expect(report.overallScore).toBeLessThan(70);
  });

  it("printHealthReport does not throw", async () => {
    const { calculateHealthScore, printHealthReport } = await import("../tools/health-score.js");
    const report = calculateHealthScore([], [], []);
    expect(() => printHealthReport(report)).not.toThrow();
  });
});

describe("Enhanced Conversion Validator", () => {
  it("exports validateEnhancedConversions and printEnhancedConversionReport", async () => {
    const mod = await import("../tools/enhanced-conversions.js");
    expect(typeof mod.validateEnhancedConversions).toBe("function");
    expect(typeof mod.printEnhancedConversionReport).toBe("function");
  });

  it("returns clean report when no conversion tags exist", async () => {
    const { validateEnhancedConversions } = await import("../tools/enhanced-conversions.js");

    const report = validateEnhancedConversions([
      mockTag({ type: "gaawe" }), // GA4 event — not a conversion tag
    ]);

    expect(report.totalConversionTags).toBe(0);
    expect(report.issues).toHaveLength(0);
    expect(report.score).toBe(100);
  });

  it("flags missing user-data tags for conversion tags", async () => {
    const { validateEnhancedConversions } = await import("../tools/enhanced-conversions.js");

    const report = validateEnhancedConversions([
      mockTag({ tagId: "1", name: "Google Ads Purchase", type: "awct" }),
    ]);

    expect(report.totalConversionTags).toBe(1);
    expect(report.userDataTags).toBe(0);
    expect(report.issues.length).toBeGreaterThan(0);
    expect(report.issues.some((i) => i.issue.includes("User-provided Data Event"))).toBe(true);
  });

  it("validates when both conversion and user-data tags exist on same trigger", async () => {
    const { validateEnhancedConversions } = await import("../tools/enhanced-conversions.js");

    const report = validateEnhancedConversions([
      mockTag({ tagId: "1", name: "Ads Purchase", type: "awct", firingTriggerId: ["100"] }),
      mockTag({
        tagId: "2",
        name: "User Data",
        type: "awud",
        firingTriggerId: ["100"],
        parameter: [{ type: "template", key: "email", value: "{{DLV - email}}" }],
      }),
    ]);

    expect(report.totalConversionTags).toBe(1);
    expect(report.userDataTags).toBe(1);
    // Should have no "missing user-data" error
    const missingDataTagError = report.issues.find((i) =>
      i.issue.includes("no matching user-data tag"),
    );
    expect(missingDataTagError).toBeUndefined();
  });

  it("printEnhancedConversionReport does not throw", async () => {
    const { validateEnhancedConversions, printEnhancedConversionReport } =
      await import("../tools/enhanced-conversions.js");
    const report = validateEnhancedConversions([]);
    expect(() => printEnhancedConversionReport(report)).not.toThrow();
  });
});

describe("SST Readiness", () => {
  it("exports assessSSTReadiness and printSSTReadinessReport", async () => {
    const mod = await import("../tools/sst-readiness.js");
    expect(typeof mod.assessSSTReadiness).toBe("function");
    expect(typeof mod.printSSTReadinessReport).toBe("function");
  });

  it("marks GA4 tags as ready", async () => {
    const { assessSSTReadiness } = await import("../tools/sst-readiness.js");

    const report = assessSSTReadiness(
      [mockTag({ tagId: "1", name: "GA4 Config", type: "gaawc" })],
      [mockVariable()],
    );

    expect(report.ready).toBe(1);
    expect(report.blockers).toBe(0);
    expect(report.tags[0].migrationStatus).toBe("ready");
  });

  it("marks custom HTML as blockers", async () => {
    const { assessSSTReadiness } = await import("../tools/sst-readiness.js");

    const report = assessSSTReadiness(
      [
        mockTag({
          tagId: "1",
          name: "Legacy Script",
          type: "html",
          parameter: [
            {
              type: "template",
              key: "html",
              value: "<script>var x = 1;\ncomplicatedLogic();\nmore();\nstuff();\nhere();</script>",
            },
          ],
        }),
      ],
      [],
    );

    expect(report.blockers).toBe(1);
    expect(report.tags[0].migrationStatus).toBe("blocker");
  });

  it("identifies Meta tags via name heuristic", async () => {
    const { assessSSTReadiness } = await import("../tools/sst-readiness.js");

    const report = assessSSTReadiness(
      [mockTag({ tagId: "1", name: "Meta Pixel - PageView", type: "html" })],
      [],
    );

    expect(report.community).toBe(1);
    expect(report.tags[0].migrationStatus).toBe("community");
    expect(report.tags[0].effort).toBe("medium");
  });

  it("does not use data layer coverage as a scoring signal", async () => {
    const { assessSSTReadiness } = await import("../tools/sst-readiness.js");

    const tags = [mockTag({ tagId: "1", name: "GA4 Config", type: "gaawc" })];
    const lowCoverage = assessSSTReadiness(tags, []);
    const highCoverage = assessSSTReadiness(tags, [
      mockVariable({ variableId: "1", name: "DLV - value", type: "v" }),
      mockVariable({ variableId: "2", name: "CONST - ID", type: "c" }),
      mockVariable({ variableId: "3", name: "DLV - currency", type: "v" }),
      mockVariable({ variableId: "4", name: "Lookup", type: "smm" }),
    ]);

    expect(lowCoverage.score).toBe(highCoverage.score);
  });

  it("detects browser routing via server_container_url", async () => {
    const { assessSSTReadiness } = await import("../tools/sst-readiness.js");

    const report = assessSSTReadiness(
      [
        mockTag({
          tagId: "1",
          name: "GA4 Config",
          type: "gaawc",
          parameter: [
            { type: "template", key: "server_container_url", value: "https://sst.example.com" },
          ],
        }),
      ],
      [],
      {
        container: {
          usageContext: ["web"],
          taggingServerUrls: ["https://sst.example.com"],
        },
      },
    );

    expect(report.serverContainerAudit.browserRoutingCheckAvailable).toBe(true);
    expect(report.serverContainerAudit.hasBrowserTaggingServerUrl).toBe(true);
  });

  it("flags default cloud domains and missing server tags on server containers", async () => {
    const { assessSSTReadiness } = await import("../tools/sst-readiness.js");
    const clients: GtmClient[] = [
      {
        clientId: "1",
        name: "GA4 Client",
        type: "ga4",
        parameter: [],
        fingerprint: "fp-1",
        path: "accounts/1/containers/1/workspaces/1/clients/1",
      },
    ];

    const report = assessSSTReadiness([], [], {
      container: {
        usageContext: ["server"],
        features: { supportClients: true, supportTransformations: true },
        taggingServerUrls: ["https://demo.tagging-server.cloud"],
      },
      clients,
      transformations: [],
    });

    expect(report.serverContainerAudit.isServerContainer).toBe(true);
    expect(report.serverContainerAudit.hasServerTags).toBe(false);
    expect(report.serverContainerAudit.usesDefaultCloudDomainOnly).toBe(true);
    expect(report.recommendations).toContain(
      "Server container has no active server tags. Add at least one destination tag such as GA4, Google Ads, or Floodlight before routing production traffic.",
    );
    expect(report.recommendations).toContain(
      "Container only uses the default *.tagging-server.cloud endpoint. Configure a first-party custom domain for better cookie durability and production routing.",
    );
  });

  it("printSSTReadinessReport does not throw", async () => {
    const { assessSSTReadiness, printSSTReadinessReport } =
      await import("../tools/sst-readiness.js");
    const report = assessSSTReadiness([], []);
    expect(() => printSSTReadinessReport(report)).not.toThrow();
  });
});
