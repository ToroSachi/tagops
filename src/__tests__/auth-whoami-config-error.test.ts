import { afterEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { ConfigError, loadConfig } from "../lib/config.js";
import { registerAuthCommands } from "../commands/auth.js";

const { checkAuthStatus, getCurrentAuthenticatedEmail, promptAuthLogin } = vi.hoisted(() => ({
  checkAuthStatus: vi.fn(),
  getCurrentAuthenticatedEmail: vi.fn(),
  promptAuthLogin: vi.fn(() => "login-hint"),
}));

const { getCurrentUserPermission, getEffectiveContainerPermission, isPermissionLookupError } =
  vi.hoisted(() => ({
    getCurrentUserPermission: vi.fn(),
    getEffectiveContainerPermission: vi.fn(),
    isPermissionLookupError: vi.fn(() => false),
  }));

vi.mock("../lib/auth.js", () => ({
  checkAuthStatus,
  getCurrentAuthenticatedEmail,
  promptAuthLogin,
}));

vi.mock("../lib/gtm-cli.js", () => ({
  getCurrentUserPermission,
  getEffectiveContainerPermission,
  isPermissionLookupError,
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

async function runWhoamiJson(): Promise<Record<string, unknown>> {
  const program = new Command();
  program.option("--json", "Output results as JSON");
  program.exitOverride();
  registerAuthCommands(program);

  const logs: string[] = [];
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    logs.push(args.map(String).join(" "));
  });

  await program.parseAsync(["node", "tagops", "--json", "auth", "whoami"]);

  const jsonLine = logs.find((line) => line.trimStart().startsWith("{"));
  expect(jsonLine).toBeDefined();
  return JSON.parse(jsonLine as string) as Record<string, unknown>;
}

describe("TOR-2135 auth whoami config-error handling", () => {
  it("loadConfig throws ConfigError (not plain Error) when no config file exists", () => {
    vi.spyOn(process, "cwd").mockReturnValue("/tmp/nonexistent-directory-tor-2135");

    let thrown: unknown;
    try {
      loadConfig();
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(ConfigError);
    expect((thrown as Error).message).toContain("No .gtmrc.json found");
  });

  it("shows the config note for a ConfigError even when the message is refactored", async () => {
    checkAuthStatus.mockResolvedValue({
      authenticated: true,
      method: "oauth",
      email: "tester@example.com",
    });
    // Deliberately no ".gtmrc.json" in the message: the old string-match
    // would miss this and rethrow; instanceof ConfigError must still note it.
    getCurrentUserPermission.mockRejectedValue(
      new ConfigError("configuration store is unavailable", ".gtmrc.json"),
    );

    const output = await runWhoamiJson();

    expect(output["authenticated"]).toBe(true);
    expect(output["note"]).toBe(
      "Configure .gtmrc.json to inspect GTM container permissions for the current account.",
    );
  });

  it("rethows non-config errors instead of mislabeling them", async () => {
    checkAuthStatus.mockResolvedValue({
      authenticated: true,
      method: "oauth",
      email: "tester@example.com",
    });
    getCurrentUserPermission.mockRejectedValue(new Error("boom"));

    const program = new Command();
    program.option("--json", "Output results as JSON");
    program.exitOverride();
    registerAuthCommands(program);
    vi.spyOn(console, "log").mockImplementation(() => {});

    await expect(
      program.parseAsync(["node", "tagops", "--json", "auth", "whoami"]),
    ).rejects.toThrow("boom");
  });
});
