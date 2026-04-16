import { describe, it, expect } from "vitest";
import { estimateEuDataLoss } from "../tools/consent-audit.js";
import type { ConsentAuditReport } from "../types/gtm.js";

function fakeReport(partial: Partial<ConsentAuditReport>): ConsentAuditReport {
  return {
    timestamp: new Date().toISOString(),
    totalTags: 50,
    auditedTags: 45,
    compliantTags: 30,
    partialTags: 4,
    nonCompliantTags: 8,
    notConfiguredTags: 3,
    complianceScore: 70,
    tags: [],
    summary: "fake",
    ...partial,
  };
}

describe("estimateEuDataLoss", () => {
  it("produces a realistic exposure number", () => {
    const report = fakeReport({});
    const e = estimateEuDataLoss(report, {
      monthlyConversions: 1000,
      avgValue: 85,
      eeaShare: 0.3,
    });
    // 11 affected of 45 consent-required = 0.2444
    // 1000 * 0.3 * 0.2444 * 85 = 6,231 gross exposure
    expect(e.affectedFraction).toBeCloseTo(11 / 45, 3);
    expect(e.monthlyExposureValue).toBeGreaterThan(6000);
    expect(e.monthlyExposureValue).toBeLessThan(6500);
    expect(e.monthlyPermanentLoss).toBeCloseTo(e.monthlyExposureValue * 0.6, -1);
    expect(e.yearlyPermanentLoss).toBe(e.monthlyPermanentLoss * 12);
  });

  it("returns zero when everything is compliant", () => {
    const report = fakeReport({
      compliantTags: 45,
      partialTags: 0,
      nonCompliantTags: 0,
      notConfiguredTags: 0,
      complianceScore: 100,
    });
    const e = estimateEuDataLoss(report, {
      monthlyConversions: 1000,
      avgValue: 85,
      eeaShare: 0.3,
    });
    expect(e.affectedFraction).toBe(0);
    expect(e.monthlyExposureValue).toBe(0);
    expect(e.monthlyPermanentLoss).toBe(0);
  });

  it("clamps EEA share to [0, 1]", () => {
    const report = fakeReport({});
    expect(
      estimateEuDataLoss(report, { monthlyConversions: 1, avgValue: 1, eeaShare: 2 }).eeaShare,
    ).toBe(1);
    expect(
      estimateEuDataLoss(report, { monthlyConversions: 1, avgValue: 1, eeaShare: -5 }).eeaShare,
    ).toBe(0);
  });

  it("handles an audit with no consent-required tags (zero by construction)", () => {
    const report = fakeReport({
      compliantTags: 0,
      partialTags: 0,
      nonCompliantTags: 0,
      notConfiguredTags: 0,
    });
    const e = estimateEuDataLoss(report, {
      monthlyConversions: 1000,
      avgValue: 100,
      eeaShare: 0.3,
    });
    expect(e.affectedFraction).toBe(0);
    expect(e.monthlyExposureValue).toBe(0);
  });
});
