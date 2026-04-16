import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import {
  buildPolicySet,
  evaluatePolicies,
  getBuiltInPolicies,
  loadPoliciesFromConfig,
} from "../lib/policies.js";
import type { GtmTag, GtmTrigger } from "../types/gtm.js";

function makeSpaTrigger(overrides: Partial<GtmTrigger> = {}): GtmTrigger {
  return {
    triggerId: "100",
    name: "CE - Page View",
    type: "CUSTOM_EVENT",
    customEventFilter: [
      {
        type: "EQUALS",
        parameter: [
          { type: "template", key: "arg0", value: "{{_event}}" },
          { type: "template", key: "arg1", value: "ce_page_view" },
        ],
      },
    ],
    ...overrides,
  };
}

function makeEventTrigger(overrides: Partial<GtmTrigger> = {}): GtmTrigger {
  return {
    triggerId: "101",
    name: "CE - Purchase",
    type: "CUSTOM_EVENT",
    customEventFilter: [
      {
        type: "EQUALS",
        parameter: [
          { type: "template", key: "arg0", value: "{{_event}}" },
          { type: "template", key: "arg1", value: "purchase" },
        ],
      },
    ],
    ...overrides,
  };
}

function makeTag(overrides: Partial<GtmTag> = {}): GtmTag {
  return {
    tagId: "1",
    name: "Tag - Example",
    type: "html",
    fingerprint: "fp-tag",
    firingTriggerId: ["100"],
    parameter: [],
    ...overrides,
  };
}

describe("policy engine", () => {
  it("returns every declared built-in policy", () => {
    expect(getBuiltInPolicies().map((policy) => policy.id)).toEqual([
      "consent-v2-advertising",
      "consent-v2-analytics",
      "spa-firing-safety",
      "no-document-write",
      "meta-dedup",
      "naming-convention",
      "no-orphaned-triggers",
      "vendor-consent-matrix",
    ]);
  });

  it("evaluates built-in policies against tags and triggers", () => {
    const policies = getBuiltInPolicies().filter((policy) =>
      [
        "consent-v2-advertising",
        "consent-v2-analytics",
        "spa-firing-safety",
        "no-document-write",
        "meta-dedup",
        "no-orphaned-triggers",
      ].includes(policy.id),
    );

    const tags: GtmTag[] = [
      makeTag({
        tagId: "ads-1",
        name: "Google Ads - Conversion",
        type: "awct",
        parameter: [],
        consentSettings: {
          consentStatus: "needed",
          consentType: {
            type: "list",
            list: [{ type: "template", value: "ad_storage" }],
          },
        },
      }),
      makeTag({
        tagId: "legacy-1",
        name: "Legacy Script",
        type: "html",
        parameter: [
          { type: "template", key: "html", value: "<script>legacy()</script>" },
          { type: "boolean", key: "supportDocumentWrite", value: "true" },
        ],
        tagFiringOption: "unlimited",
      }),
      makeTag({
        tagId: "ga4-1",
        name: "GA4 - Purchase",
        type: "gaawe",
        fingerprint: "fp-ga4",
        firingTriggerId: ["101"],
        consentSettings: {
          consentStatus: "needed",
          consentType: { type: "list", list: [] },
        },
      }),
    ];

    const triggers: GtmTrigger[] = [
      makeSpaTrigger(),
      makeEventTrigger(),
      { triggerId: "200", name: "CE - Orphaned", type: "CUSTOM_EVENT" },
    ];

    const report = evaluatePolicies(tags, triggers, [], policies);

    expect(report.summary.errors).toBe(3);
    expect(report.summary.warnings).toBe(2);
    expect(report.summary.info).toBe(1);
    expect(report.violations.map((violation) => violation.policyId)).toEqual([
      "consent-v2-analytics",
      "consent-v2-advertising",
      "no-document-write",
      "spa-firing-safety",
      "spa-firing-safety",
      "no-orphaned-triggers",
    ]);
  });

  it("only enforces Meta eventID when server-side Meta is present", () => {
    const policies = getBuiltInPolicies().filter((policy) => policy.id === "meta-dedup");

    const browserOnlyReport = evaluatePolicies(
      [
        makeTag({
          tagId: "meta-browser",
          name: "Meta - Page View",
          parameter: [
            { type: "template", key: "html", value: "<script>fbq('track','PageView')</script>" },
          ],
        }),
      ],
      [makeSpaTrigger()],
      [],
      policies,
    );

    expect(browserOnlyReport.violations).toEqual([]);

    const browserServerReport = evaluatePolicies(
      [
        makeTag({
          tagId: "meta-browser",
          name: "Meta - Page View",
          parameter: [
            { type: "template", key: "html", value: "<script>fbq('track','PageView')</script>" },
          ],
        }),
        makeTag({
          tagId: "meta-capi",
          name: "Meta CAPI - Purchase",
          parameter: [
            {
              type: "template",
              key: "html",
              value: "<script>fetch('https://graph.facebook.com/v20.0/events')</script>",
            },
          ],
        }),
      ],
      [makeSpaTrigger()],
      [],
      policies,
    );

    expect(browserServerReport.violations).toHaveLength(1);
    expect(browserServerReport.violations[0].policyId).toBe("meta-dedup");
    expect(browserServerReport.violations[0].resourceName).toBe("Meta - Page View");
  });

  it("applies naming configuration through the policy set builder", () => {
    const policies = buildPolicySet({
      enabledPolicies: ["naming-convention"],
      naming: {
        tagPrefix: "TAG - ",
        triggerPrefix: "TRG - ",
      },
    });

    const report = evaluatePolicies(
      [makeTag({ name: "Bad Tag Name" })],
      [{ triggerId: "bad-trigger", name: "Bad Trigger Name", type: "CUSTOM_EVENT" }],
      [],
      policies,
    );

    expect(report.passed).toBe(true);
    expect(report.summary.warnings).toBe(2);
    expect(report.violations.every((violation) => violation.policyId === "naming-convention")).toBe(
      true,
    );
  });

  it("loads declarative custom policies from config", () => {
    const tempDir = mkdtempSync(join(tmpdir(), "tagops-policies-"));
    const configPath = join(tempDir, ".tagops-policies.json");

    writeFileSync(
      configPath,
      JSON.stringify(
        {
          enabledPolicies: ["meta-ad-storage"],
          customPolicies: [
            {
              id: "meta-ad-storage",
              name: "Meta Requires ad_storage",
              description: "Meta tags must require ad_storage",
              severity: "error",
              category: "vendor",
              target: "tag",
              match: {
                vendorIn: ["Meta"],
              },
              require: {
                consentSignals: ["ad_storage"],
              },
            },
          ],
        },
        null,
        2,
      ),
    );

    try {
      const policies = loadPoliciesFromConfig(configPath);
      const report = evaluatePolicies(
        [
          makeTag({
            tagId: "meta-custom",
            name: "Meta - Purchase",
            parameter: [{ type: "template", key: "html", value: "<script>fbq('track')</script>" }],
            consentSettings: { consentStatus: "notSet" },
          }),
        ],
        [makeSpaTrigger()],
        [],
        policies,
      );

      expect(report.passed).toBe(false);
      expect(report.summary.errors).toBe(1);
      expect(report.violations[0].policyId).toBe("meta-ad-storage");
    } finally {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
