import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

describe("Project Initialization", () => {
  let tempDir = "";

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "tagops-init-project-"));
    vi.spyOn(process, "cwd").mockReturnValue(tempDir);
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it("creates a valid placeholder config, policies, and CI workflows", async () => {
    const { initProject } = await import("../tools/init-project.js");
    const { loadConfig } = await import("../lib/config.js");

    const report = initProject({ ci: true });

    expect(report.configCreated).toBe(true);
    expect(report.configUpdated).toBe(false);
    expect(report.policiesCreated).toBe(true);
    expect(report.filesCreated).toHaveLength(3);

    const config = loadConfig();
    expect(config.accountId).toBe("YOUR-ACCOUNT-ID");
    expect(config.containerId).toBe("YOUR-CONTAINER-ID");
    expect(config.workspaceId).toBe("YOUR-WORKSPACE-ID");

    expect(existsSync(resolve(tempDir, ".tagops-policies.json"))).toBe(true);

    const prWorkflow = readFileSync(
      resolve(tempDir, ".github/workflows/gtm-pr-checks.yml"),
      "utf-8",
    );
    expect(prWorkflow).toContain(".tagops-policies.json");
    expect(prWorkflow).not.toContain("policy-check --strict");
  });

  it("updates an existing config when explicit IDs are provided", async () => {
    const { initProject } = await import("../tools/init-project.js");
    const { writeConfig, loadConfig } = await import("../lib/config.js");

    writeConfig({
      accountId: "111111",
      containerId: "222222",
      workspaceId: "3",
      promotionFlow: ["development", "staging", "production"],
      profiles: [
        {
          name: "staging",
          accountId: "111111",
          containerId: "222222",
          workspaceId: "4",
        },
      ],
    });

    const report = initProject({
      accountId: "999999",
      containerId: "888888",
      workspaceId: "7",
      ci: true,
      branch: "release",
    });

    expect(report.configCreated).toBe(false);
    expect(report.configUpdated).toBe(true);
    expect(report.branch).toBe("release");

    const config = loadConfig();
    expect(config.accountId).toBe("999999");
    expect(config.containerId).toBe("888888");
    expect(config.workspaceId).toBe("7");
    expect(config.promotionFlow).toEqual(["development", "staging", "production"]);
    expect(config.profiles).toHaveLength(1);
    expect(config.profiles?.[0]?.name).toBe("staging");

    const prWorkflow = readFileSync(
      resolve(tempDir, ".github/workflows/gtm-pr-checks.yml"),
      "utf-8",
    );
    expect(prWorkflow).toContain("- release");
  });
});
