import { vi } from "vitest";

/**
 * Standardized mock setup for GTM CLI functions.
 * Use this in test files instead of duplicating vi.mock() everywhere.
 *
 * Usage:
 *   import { setupGtmMock } from "./utils/mock-api.js";
 *   setupGtmMock();
 */
export function setupGtmMock() {
  vi.mock("../lib/gtm-cli.js", () => ({
    listTags: vi.fn(),
    listTriggers: vi.fn(),
    listVariables: vi.fn(),
    listWorkspaces: vi.fn(),
    createTag: vi.fn(),
    updateTag: vi.fn(),
    deleteTag: vi.fn(),
    createTrigger: vi.fn(),
    deleteTrigger: vi.fn(),
    createVariable: vi.fn(),
    deleteVariable: vi.fn(),
    getTag: vi.fn(),
    getTrigger: vi.fn(),
    getVariable: vi.fn(),
    getWorkspacePath: vi.fn(() => "accounts/1/containers/2/workspaces/3"),
    buildHtmlTagConfig: vi.fn(),
    buildConsentConfig: vi.fn(),
  }));

  // Also mock architecture constants that might trigger real network requests
  vi.mock("../lib/architecture.js", async (importOriginal) => {
    const actual = (await importOriginal()) as any;
    return {
      ...actual,
      BUILTIN_TRIGGER_IDS: new Set(["2147479553"]),
    };
  });
}

/**
 * Helper to seed the mocked GTM workspace with data.
 */
export async function seedMockWorkspace(
  tags: any[] = [],
  triggers: any[] = [],
  variables: any[] = [],
) {
  const gtmCli = await import("../../lib/gtm-cli.js");
  (gtmCli.listTags as any).mockResolvedValue(tags);
  (gtmCli.listTriggers as any).mockResolvedValue(triggers);
  (gtmCli.listVariables as any).mockResolvedValue(variables);
}
