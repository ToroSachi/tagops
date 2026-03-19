/**
 * Tests for the GTM Linter.
 */

import { describe, it, expect } from "vitest";
import { runLinter, type LintRules } from "../tools/lint.js";
import type { GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

describe("GTM Linter", () => {
  it("passes when all rules are satisfied", () => {
    const tags = [
      {
        tagId: "1",
        name: "GA4 - Page View",
        type: "gaawe",
        consentSettings: { consentStatus: "needed" },
      },
    ];
    const triggers = [{ triggerId: "2", name: "CE - Purchase", type: "CUSTOM_EVENT" }];
    const variables = [{ variableId: "3", name: "DLV - Value", type: "v" }];

    const rules: LintRules = {
      "require-consent": true,
      "block-custom-html": true,
      "naming-conventions": {
        tags: "^GA4",
        triggers: "^CE - ",
        variables: "^DLV - ",
      },
    };

    const report = runLinter(
      [...tags] as any,
      [...triggers] as any,
      [...variables] as any,
      rules,
      "Test",
    );
    expect(report.passed).toBe(true);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(0);
  });

  it("fails when tag is missing consent (require-consent)", () => {
    const tags = [
      {
        tagId: "1",
        name: "Missing Consent",
        type: "html",
        consentSettings: { consentStatus: "notSet" },
      },
      {
        tagId: "2",
        name: "Missing Consent Obj",
        type: "gaawe",
      },
      {
        tagId: "3",
        name: "Paused Tags Ignore Consent",
        type: "html",
        paused: true,
      },
    ];

    const report = runLinter([...tags] as any, [], [], { "require-consent": true } as any, "Test");

    // Should flag tag 1 and 2, but ignore paused tag 3
    expect(report.passed).toBe(false);
    expect(report.summary.errors).toBe(2);
    expect(report.violations.some((v) => v.resourceId === "1")).toBe(true);
    expect(report.violations.some((v) => v.resourceId === "2")).toBe(true);
    expect(report.violations.some((v) => v.resourceId === "3")).toBe(false);
  });

  it("fails when block-custom-html is true", () => {
    const tags = [
      {
        tagId: "1",
        name: "Bad Script",
        type: "html",
        consentSettings: { consentStatus: "needed" },
      },
    ];

    const report = runLinter(
      [...tags] as any,
      [],
      [],
      { "block-custom-html": true } as any,
      "Test",
    );
    expect(report.passed).toBe(false);
    expect(report.summary.errors).toBe(1);
    expect(report.violations[0].rule).toBe("block-custom-html");
  });

  it("emits warnings for bad naming conventions", () => {
    const tags = [
      {
        tagId: "1",
        name: "bad tag name",
        type: "gaawe",
        consentSettings: { consentStatus: "needed" },
      },
    ];
    const triggers = [{ triggerId: "2", name: "trigger", type: "CUSTOM_EVENT" }];
    const variables = [{ variableId: "3", name: "value", type: "v" }];

    const rules: LintRules = {
      "require-consent": true,
      "naming-conventions": {
        tags: "^[A-Z]",
        triggers: "^CE - ",
        variables: "^DLV - ",
      },
    };

    const report = runLinter(
      [...tags] as any,
      [...triggers] as any,
      [...variables] as any,
      rules as any,
      "Test",
    );

    // Naming conventions emit warnings, not errors. So build "passes" but has warnings.
    expect(report.passed).toBe(true);
    expect(report.summary.errors).toBe(0);
    expect(report.summary.warnings).toBe(3);
  });
});
