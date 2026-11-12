import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";

vi.mock("../lib/config.js", () => ({
  loadConfig: () => ({ accountId: "1", containerId: "2", workspaceId: "3" }),
}));

vi.mock("../lib/gtm-cli.js", () => ({
  getContainer: async () => ({ features: {} }),
  listBuiltInVariables: async () => [],
  listClients: async () => [],
  listEnvironments: async () => [],
  listFolders: async () => [],
  listTags: async () => [],
  listTransformations: async () => [],
  listTriggers: async () => [],
  listVariables: async () => [],
}));

import { takeSnapshot } from "../tools/snapshot.js";

it("commits one snapshot path and leaves unrelated staged work intact", async () => {
  const root = mkdtempSync(join(tmpdir(), "tagops-snapshot-git-"));
  const originalCwd = process.cwd();
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: root, encoding: "utf8", stdio: "pipe" }).trim();

  try {
    git("init");
    git("config", "user.name", "Snapshot Test");
    git("config", "user.email", "snapshot-test@example.invalid");
    git("config", "commit.gpgsign", "false");
    git("config", "core.hooksPath", join(root, "disabled-hooks"));
    git("commit", "--allow-empty", "-m", "initial");
    writeFileSync(join(root, "unrelated.txt"), "already staged");
    git("add", "--", "unrelated.txt");

    process.chdir(root);
    const result = await takeSnapshot("snapshot with spaces.json", {}, true);

    expect(result.gitCommitSha).toBe(git("rev-parse", "HEAD"));
    expect(git("show", "--pretty=format:", "--name-only", "HEAD")).toBe(
      "snapshot with spaces.json",
    );
    expect(git("diff", "--cached", "--name-only")).toBe("unrelated.txt");
    expect(JSON.parse(git("show", "HEAD:snapshot with spaces.json")).schemaVersion).toBe("1.0");
  } finally {
    process.chdir(originalCwd);
    rmSync(root, { recursive: true, force: true });
  }
});
