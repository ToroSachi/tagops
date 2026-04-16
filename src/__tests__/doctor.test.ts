/**
 * Tests for Doctor diagnostic command
 */

import { describe, it, expect, vi } from "vitest";

describe("Doctor Command", () => {
  it("returns a report with all check categories", async () => {
    // Mock the external dependencies to avoid real API calls
    vi.doMock("../lib/config.js", () => ({
      loadConfig: () => ({ accountId: "123", containerId: "456", workspaceId: "1" }),
    }));
    vi.doMock("../lib/auth.js", () => ({
      checkAuthStatus: vi.fn().mockResolvedValue({ authenticated: false, method: "none" }),
    }));
    vi.doMock("../lib/gtm-cli.js", () => ({
      listTags: vi.fn().mockRejectedValue(new Error("No auth")),
      listTriggers: vi.fn().mockRejectedValue(new Error("No auth")),
      listVariables: vi.fn().mockRejectedValue(new Error("No auth")),
    }));

    const { runDoctor } = await import("../tools/doctor.js");
    const report = await runDoctor();

    expect(report.checks).toBeDefined();
    expect(report.checks.length).toBeGreaterThanOrEqual(2);
    expect(report.passed).toBeDefined();
    expect(report.warnings).toBeDefined();
    expect(report.failures).toBeDefined();

    // Node.js check should always pass in test environment
    const nodeCheck = report.checks.find((c) => c.name === "Node.js Version");
    expect(nodeCheck).toBeDefined();
    expect(nodeCheck!.status).toBe("pass");
  });

  it("prints a formatted report without errors", async () => {
    const { printDoctorReport } = await import("../tools/doctor.js");

    const mockReport = {
      checks: [
        { name: "Node.js Version", status: "pass" as const, detail: "v23.6.0" },
        { name: "Configuration", status: "pass" as const, detail: "OK" },
        { name: "Google Credentials", status: "fail" as const, detail: "Not found" },
      ],
      passed: 2,
      warnings: 0,
      failures: 1,
    };

    // Should not throw
    expect(() => printDoctorReport(mockReport)).not.toThrow();
  });
});
