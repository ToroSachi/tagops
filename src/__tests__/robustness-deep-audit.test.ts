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
});
