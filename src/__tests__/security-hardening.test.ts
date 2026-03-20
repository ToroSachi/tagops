import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

describe("Path Safety", () => {
  const projectRoot = "/tmp/tagops-path-safety";
  const configPath = resolve(projectRoot, ".gtmrc.json");

  beforeEach(() => {
    mkdirSync(projectRoot, { recursive: true });
    writeFileSync(
      configPath,
      JSON.stringify({ accountId: "acct-1", containerId: "cont-1", workspaceId: "ws-1" }),
    );
    vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("allows relative paths inside the project root", async () => {
    const { resolveProjectPath } = await import("../lib/path-safety.js");
    expect(resolveProjectPath("snapshots/current.json", "Snapshot")).toBe(
      resolve(projectRoot, "snapshots/current.json"),
    );
  });

  it("rejects absolute and traversal paths", async () => {
    const { resolveProjectPath } = await import("../lib/path-safety.js");

    expect(() => resolveProjectPath("/tmp/outside.json", "Snapshot")).toThrow("must be relative");
    expect(() => resolveProjectPath("../outside.json", "Snapshot")).toThrow(
      "must not contain '..'",
    );
  });
});

describe("Config Hardening", () => {
  const projectRoot = "/tmp/tagops-config-hardening";
  const configPath = resolve(projectRoot, ".gtmrc.json");

  beforeEach(() => {
    mkdirSync(projectRoot, { recursive: true });
    vi.spyOn(process, "cwd").mockReturnValue(projectRoot);
  });

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it("rejects unsafe identifiers in config files", async () => {
    writeFileSync(
      configPath,
      JSON.stringify({
        accountId: "acct-1",
        containerId: "cont-1",
        workspaceId: "ws-1",
        profiles: [
          {
            name: "../prod",
            accountId: "acct-2",
            containerId: "cont-2",
            workspaceId: "ws-2",
          },
        ],
      }),
    );

    const { loadConfig } = await import("../lib/config.js");
    expect(() => loadConfig()).toThrow("must contain only letters, numbers, and dashes");
  });
});

describe("Redaction", () => {
  it("redacts sensitive token and key material from messages", async () => {
    const { getSafeErrorMessage } = await import("../lib/redaction.js");
    const message = getSafeErrorMessage(
      "access_token=secret refresh_token=refresh client_secret=super-secret Bearer abc.def.ghi",
    );

    expect(message).toContain("[REDACTED]");
    expect(message).not.toContain("access_token=secret");
    expect(message).not.toContain("refresh_token=refresh");
    expect(message).not.toContain("super-secret");
    expect(message).not.toContain("abc.def.ghi");
  });
});

describe("Snapshot Size Warning", () => {
  const outputPath = resolve("/tmp/tagops-large-snapshot.json");

  afterEach(() => {
    if (existsSync(outputPath)) unlinkSync(outputPath);
    vi.doUnmock("../lib/config.js");
    vi.doUnmock("../lib/gtm-cli.js");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("warns when a snapshot exceeds 50MB", async () => {
    vi.doMock("../lib/config.js", () => ({
      loadConfig: () => ({
        accountId: "acct-1",
        containerId: "cont-1",
        workspaceId: "ws-1",
      }),
    }));
    vi.doMock("../lib/gtm-cli.js", () => ({
      getContainer: vi.fn().mockResolvedValue({}),
      listTags: vi.fn().mockResolvedValue([]),
      listTriggers: vi.fn().mockResolvedValue([]),
      listVariables: vi.fn().mockResolvedValue([]),
      listFolders: vi.fn().mockResolvedValue([]),
      listBuiltInVariables: vi.fn().mockResolvedValue([]),
      listEnvironments: vi.fn().mockResolvedValue([]),
      listClients: vi.fn().mockResolvedValue([]),
      listTransformations: vi.fn().mockResolvedValue([]),
    }));

    const snapshotModule = await import("../tools/snapshot.js");
    vi.spyOn(Buffer, "byteLength").mockReturnValue(60 * 1024 * 1024);

    const result = await snapshotModule.takeSnapshot(outputPath);

    expect(result.warning).toContain("exceeds the recommended 50MB size");
    expect(result.sizeBytes).toBe(60 * 1024 * 1024);
  });
});

describe("Concurrency Parsing", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("parses valid concurrency and rejects invalid values", async () => {
    const { parseConcurrencyOption, resolveConcurrencyLimit } =
      await import("../lib/concurrency.js");

    expect(parseConcurrencyOption("3")).toBe(3);
    expect(() => parseConcurrencyOption("0")).toThrow("positive integer");

    vi.stubEnv("TAGOPS_CONCURRENCY", "7");
    expect(resolveConcurrencyLimit()).toBe(7);
  });
});
