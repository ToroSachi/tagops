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

describe("Snapshot git commit command injection", () => {
  // Exact shell-injection shape from TOR-2131 — must never reach a shell.
  const maliciousOutput = 'ok.json"; touch /tmp/pwned; echo "';

  afterEach(() => {
    vi.doUnmock("../lib/config.js");
    vi.doUnmock("../lib/gtm-cli.js");
    vi.doUnmock("node:child_process");
    vi.doUnmock("node:fs");
    vi.resetModules();
    vi.restoreAllMocks();
  });

  it("passes metacharacter output paths as argv to execFileSync, never via a shell", async () => {
    const expectedResolved = resolve(maliciousOutput);

    const execFileSync = vi.fn((cmd: string, args: string[]) => {
      if (cmd === "git" && args[0] === "rev-parse") return Buffer.from("deadbeef\n");
      return Buffer.from("");
    });
    const execSync = vi.fn(() => {
      throw new Error("execSync must not be used for snapshot git commit");
    });
    const writeFileSync = vi.fn();

    vi.doMock("node:child_process", () => ({ execFileSync, execSync }));
    vi.doMock("node:fs", async (importOriginal) => {
      const actual = await importOriginal<typeof import("node:fs")>();
      return { ...actual, writeFileSync };
    });
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
    const result = await snapshotModule.takeSnapshot(maliciousOutput, {}, true);

    expect(writeFileSync).toHaveBeenCalledWith(expectedResolved, expect.any(String));
    expect(execSync).not.toHaveBeenCalled();
    expect(execFileSync).toHaveBeenCalledWith(
      "git",
      ["add", "--", expectedResolved],
      expect.objectContaining({ stdio: "pipe" }),
    );
    // Never a shell string like `git add "…"`.
    expect(
      execFileSync.mock.calls.some(
        (call) => typeof call[0] === "string" && String(call[0]).includes("git add"),
      ),
    ).toBe(false);
    const addCall = execFileSync.mock.calls.find(
      (call) => Array.isArray(call[1]) && call[1][0] === "add",
    );
    expect(addCall?.[1]).toEqual(["add", "--", expectedResolved]);
    expect(addCall?.[1]?.[2]).toContain('"; touch');
    expect(result.gitCommitSha).toBe("deadbeef");
  });

  it("refuses snapshot output paths that contain newlines", async () => {
    const { assertSafeSnapshotOutputPath } = await import("../tools/snapshot.js");
    expect(() => assertSafeSnapshotOutputPath("ok.json\nrm -rf /")).toThrow("without newlines");
  });
});

describe("Webhook SSRF DNS gating", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("blocks private IP literals and hostnames that resolve to private/link-local addresses", async () => {
    const {
      validateWebhookUrl,
      validateWebhookUrlResolved,
      isBlockedWebhookAddress,
      sendWebhook,
    } = await import("../tools/watch.js");

    expect(isBlockedWebhookAddress("127.0.0.1")).toBe(true);
    expect(isBlockedWebhookAddress("169.254.169.254")).toBe(true);
    expect(isBlockedWebhookAddress("10.0.0.5")).toBe(true);
    expect(isBlockedWebhookAddress("8.8.8.8")).toBe(false);

    expect(() => validateWebhookUrl("http://127.0.0.1/hook")).toThrow("blocked address");
    expect(() => validateWebhookUrl("http://169.254.169.254/latest/meta-data")).toThrow(
      "blocked address",
    );

    await expect(
      validateWebhookUrlResolved("https://metadata.google.internal/hook", async () => "169.254.169.254"),
    ).rejects.toThrow(/blocked/i);

    // Host is not a literal private IP, but DNS says it is — must refuse before fetch.
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendWebhook(
      "https://evil.example/hook",
      {
        event: "custom",
        timestamp: new Date().toISOString(),
        summary: "ssrf probe",
      },
      { lookup: async () => "169.254.169.254" },
    );

    expect(result.sent).toBe(false);
    expect(result.error).toMatch(/blocked address/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("strips the webhook URL from fetch failure messages", async () => {
    const { sendWebhook } = await import("../tools/watch.js");
    const webhookUrl = "https://hooks.example.com/services/ABC/DEF";

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(`fetch failed for ${webhookUrl}: ECONNREFUSED`);
      }),
    );

    const result = await sendWebhook(
      webhookUrl,
      {
        event: "custom",
        timestamp: new Date().toISOString(),
        summary: "notify",
      },
      { lookup: async () => "93.184.216.34" },
    );

    expect(result.sent).toBe(false);
    expect(result.error).toContain("[webhook-url]");
    expect(result.error).not.toContain(webhookUrl);
  });
});
