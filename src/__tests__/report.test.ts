import { describe, it, expect } from "vitest";
import { generateHtmlReport, generateMarkdownReport } from "../tools/report.js";
import type { ContainerHealthReport } from "../tools/health-score.js";
import type { AuditReport } from "../types/gtm.js";

const health: ContainerHealthReport = {
  timestamp: "2026-04-13T00:00:00.000Z",
  overallScore: 82,
  grade: "B",
  totalTags: 12,
  totalTriggers: 5,
  totalVariables: 9,
  summary: "Container is in good shape with one consent gap.",
  components: [
    {
      name: "Consent Coverage",
      score: 95,
      weight: 0.3,
      details: "11/12 tags have consent settings.",
    },
    {
      name: "Trigger Hygiene",
      score: 70,
      weight: 0.2,
      details: "1 unused trigger.",
    },
  ],
};

const audit: AuditReport = {
  totalTags: 12,
  totalTriggers: 5,
  pausedTags: [],
  issues: [
    {
      type: "CONSENT_NOT_SET",
      severity: "high",
      name: "Meta Pixel - PageView",
      tagId: "42",
      detail: "Tag missing consent settings",
    },
    {
      type: "ORPHANED_TRIGGER",
      severity: "low",
      name: "Legacy Trigger",
      triggerId: "99",
      detail: "Not referenced by any tag",
    },
  ],
};

describe("Report generation", () => {
  it("markdown report includes grade and all issue types", () => {
    const md = generateMarkdownReport(health, audit);
    expect(md).toContain("# GTM Workspace Quality Report");
    expect(md).toContain("**B**");
    expect(md).toContain("CONSENT NOT SET");
    expect(md).toContain("ORPHANED TRIGGER");
  });

  it("html report is a self-contained document with escaped content", () => {
    const html = generateHtmlReport(health, audit);
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<title>GTM Quality Report");
    expect(html).toContain("<style>");
    expect(html).toContain("Meta Pixel - PageView");
    expect(html).toContain("CONSENT NOT SET");
    // No external asset references
    expect(html).not.toMatch(/<link[^>]+href="http/);
    expect(html).not.toMatch(/<script[^>]+src="http/);
  });

  it("html report escapes HTML-unsafe characters in audit detail", () => {
    const dangerous: AuditReport = {
      totalTags: 1,
      totalTriggers: 0,
      pausedTags: [],
      issues: [
        {
          type: "CONSENT_NOT_SET",
          severity: "high",
          name: '<img src=x onerror="alert(1)">',
          tagId: "1",
          detail: "<script>alert('xss')</script>",
        },
      ],
    };
    const html = generateHtmlReport(health, dangerous);
    expect(html).not.toContain("<script>alert('xss')</script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
  });

  it("html report shows '✅ No issues found' when audit is clean", () => {
    const clean: AuditReport = {
      totalTags: 0,
      totalTriggers: 0,
      pausedTags: [],
      issues: [],
    };
    const html = generateHtmlReport(health, clean);
    expect(html).toContain("No issues found");
  });
});
