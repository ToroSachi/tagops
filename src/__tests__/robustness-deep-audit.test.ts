import { describe, it, expect, vi } from "vitest";
import { TagOpsError, ErrorCode } from "../lib/errors.js";
import { auditWorkspace } from "../tools/audit.js";

// Mock gtm-cli to avoid real API calls
vi.mock("../lib/gtm-cli.js", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    listTags: vi.fn(),
    listTriggers: vi.fn(),
    listVariables: vi.fn(),
    verifyGtmConnection: vi.fn(),
    listWorkspaces: vi.fn(),
  };
});

import { listTags, listTriggers, listVariables } from "../lib/gtm-cli.js";

describe("Robustness & Deep Audit", () => {
  describe("Conflict Handling", () => {
    it("TagOpsError maps 409 conflicts correctly", () => {
      const err = new TagOpsError({
        code: ErrorCode.API_FORBIDDEN,
        message: "Conflict detected in updateTag. GTM resource was modified elsewhere.",
      });
      expect(err.name).toBe("TagOpsError");
      expect(err.code).toBe(ErrorCode.API_FORBIDDEN);
    });
  });

  describe("Missing Variable Detection", () => {
    it("flags missing variable references in tags", async () => {
      // Setup mock data
      (listTags as any).mockResolvedValue([
        {
          tagId: "1",
          name: "Test Tag",
          type: "html",
          parameter: [{ key: "html", value: "var x = {{Missing Var}};" }],
          paused: false,
        },
      ]);
      (listTriggers as any).mockResolvedValue([]);
      (listVariables as any).mockResolvedValue([{ name: "Existing Var" }]);

      const report = await auditWorkspace();
      const missingVarIssues = report.issues.filter((i) => i.type === "MISSING_VARIABLE_REF");

      expect(missingVarIssues.length).toBe(1);
      expect(missingVarIssues[0].detail).toContain("{{Missing Var}}");
    });

    it("does NOT flag GTM built-in variables", async () => {
      (listTags as any).mockResolvedValue([
        {
          tagId: "1",
          name: "Test Tag",
          type: "html",
          parameter: [{ key: "html", value: "var url = {{Page URL}};" }],
          paused: false,
        },
      ]);
      (listTriggers as any).mockResolvedValue([]);
      (listVariables as any).mockResolvedValue([]);

      const report = await auditWorkspace();
      const missingVarIssues = report.issues.filter((i) => i.type === "MISSING_VARIABLE_REF");

      expect(missingVarIssues.length).toBe(0);
    });

    it("flags missing variables in trigger conditions", async () => {
      (listTags as any).mockResolvedValue([]);
      (listTriggers as any).mockResolvedValue([
        {
          triggerId: "10",
          name: "Test Trigger",
          filter: [
            {
              type: "equals",
              parameter: [
                { type: "template", key: "arg0", value: "{{Broken Trigger Var}}" },
                { type: "template", key: "arg1", value: "test" },
              ],
            },
          ],
        },
      ]);
      (listVariables as any).mockResolvedValue([]);

      const report = await auditWorkspace();
      const missingVarIssues = report.issues.filter((i) => i.type === "MISSING_VARIABLE_REF");

      expect(missingVarIssues.length).toBe(1);
      expect(missingVarIssues[0].name).toBe("Test Trigger");
    });
  });

  describe("Tag Sequencing Validation", () => {
    it("flags tags that reference missing setup tags", async () => {
      (listTags as any).mockResolvedValue([
        {
          tagId: "1",
          name: "Vendor - Purchase",
          type: "html",
          firingTriggerId: ["10"],
          setupTag: [{ tagName: "Vendor - Base", stopOnSetupFailure: true }],
          paused: false,
        },
      ]);
      (listTriggers as any).mockResolvedValue([{ triggerId: "10", name: "CE - Purchase" }]);
      (listVariables as any).mockResolvedValue([]);

      const report = await auditWorkspace();
      const setupIssues = report.issues.filter((i) => i.type === "MISSING_SETUP_TAG");

      expect(setupIssues).toHaveLength(1);
      expect(setupIssues[0]?.detail).toContain("Vendor - Base");
    });

    it("does not flag setup tags that resolve to live tags", async () => {
      (listTags as any).mockResolvedValue([
        {
          tagId: "1",
          name: "Vendor - Base",
          type: "html",
          firingTriggerId: ["10"],
          paused: false,
        },
        {
          tagId: "2",
          name: "Vendor - Purchase",
          type: "html",
          firingTriggerId: ["10"],
          setupTag: [{ tagName: "Vendor - Base", stopOnSetupFailure: true }],
          paused: false,
        },
      ]);
      (listTriggers as any).mockResolvedValue([{ triggerId: "10", name: "CE - Purchase" }]);
      (listVariables as any).mockResolvedValue([]);

      const report = await auditWorkspace();
      const setupIssues = report.issues.filter((i) => i.type === "MISSING_SETUP_TAG");

      expect(setupIssues).toHaveLength(0);
    });
  });

  describe("SPA Firing Audit", () => {
    it("flags unlimited firing only for SPA-style triggers", async () => {
      (listTags as any).mockResolvedValue([
        {
          tagId: "1",
          name: "Meta – Page View",
          type: "html",
          firingTriggerId: ["100"],
          paused: false,
          tagFiringOption: "unlimited",
        },
        {
          tagId: "2",
          name: "CTA Click",
          type: "html",
          firingTriggerId: ["200"],
          paused: false,
          tagFiringOption: "unlimited",
        },
      ]);
      (listTriggers as any).mockResolvedValue([
        {
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
        },
        {
          triggerId: "200",
          name: "Click - CTA",
          type: "CLICK",
        },
      ]);
      (listVariables as any).mockResolvedValue([]);

      const report = await auditWorkspace();
      const unlimitedFiringIssues = report.issues.filter(
        (issue) => issue.type === "UNLIMITED_FIRING",
      );

      expect(unlimitedFiringIssues).toHaveLength(1);
      expect(unlimitedFiringIssues[0]?.tagId).toBe("1");
    });
  });

  describe("Consent Alignment", () => {
    it("uses policy-aligned consent signals for Google Ads measurement tags", async () => {
      (listTags as any).mockResolvedValue([
        {
          tagId: "1",
          name: "Google Ads - Conversion",
          type: "awct",
          firingTriggerId: ["10"],
          fingerprint: "fp-1",
          paused: false,
          consentSettings: {
            consentStatus: "needed",
            consentType: { type: "list", list: [{ type: "template", value: "ad_storage" }] },
          },
        },
      ]);
      (listTriggers as any).mockResolvedValue([
        { triggerId: "10", name: "CE - Purchase", type: "CUSTOM_EVENT" },
      ]);
      (listVariables as any).mockResolvedValue([]);

      const report = await auditWorkspace();
      expect(report.issues).toContainEqual(
        expect.objectContaining({
          type: "WRONG_CONSENT",
          tagId: "1",
          detail: expect.stringContaining("ad_user_data"),
        }),
      );
    });

    it("only flags Meta eventID when browser/server dedup is present", async () => {
      (listTags as any).mockResolvedValue([
        {
          tagId: "1",
          name: "Meta - Page View",
          type: "html",
          fingerprint: "fp-1",
          firingTriggerId: ["10"],
          paused: false,
          parameter: [{ key: "html", value: "<script>fbq('track','PageView')</script>" }],
          consentSettings: {
            consentStatus: "needed",
            consentType: { type: "list", list: [{ type: "template", value: "ad_storage" }] },
          },
        },
      ]);
      (listTriggers as any).mockResolvedValue([
        { triggerId: "10", name: "CE - Purchase", type: "CUSTOM_EVENT" },
      ]);
      (listVariables as any).mockResolvedValue([]);

      const browserOnlyReport = await auditWorkspace();
      expect(browserOnlyReport.issues.some((issue) => issue.type === "MISSING_EVENT_ID")).toBe(
        false,
      );

      (listTags as any).mockResolvedValue([
        {
          tagId: "1",
          name: "Meta - Page View",
          type: "html",
          fingerprint: "fp-1",
          firingTriggerId: ["10"],
          paused: false,
          parameter: [{ key: "html", value: "<script>fbq('track','PageView')</script>" }],
          consentSettings: {
            consentStatus: "needed",
            consentType: { type: "list", list: [{ type: "template", value: "ad_storage" }] },
          },
        },
        {
          tagId: "2",
          name: "Meta CAPI - Purchase",
          type: "html",
          fingerprint: "fp-2",
          firingTriggerId: ["10"],
          paused: false,
          parameter: [
            {
              key: "html",
              value: "<script>fetch('https://graph.facebook.com/v20.0/events')</script>",
            },
          ],
          consentSettings: {
            consentStatus: "needed",
            consentType: { type: "list", list: [{ type: "template", value: "ad_storage" }] },
          },
        },
      ]);

      const browserServerReport = await auditWorkspace();
      expect(browserServerReport.issues).toContainEqual(
        expect.objectContaining({
          type: "MISSING_EVENT_ID",
          tagId: "1",
        }),
      );
    });
  });
});
