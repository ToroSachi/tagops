/**
 * TOR-2134: consent --fix action lines must not print raw Google API errors.
 *
 * Google API error messages can carry tokens / quota-project IDs; both
 * fixConsentV2 and fixFiring pushed (err as Error).message straight into the
 * printed `actions` output. Both now route through getSafeErrorMessage.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { GtmTag, GtmTrigger } from "../types/gtm.js";

const listTags = vi.fn();
const listTriggers = vi.fn();
const getTag = vi.fn();
const updateTag = vi.fn();

vi.mock("../lib/gtm-cli.js", () => ({
  buildCompleteTagConfig: vi.fn((tag: object, overrides: Record<string, unknown> = {}) => ({
    ...(structuredClone(tag) as Record<string, unknown>),
    ...overrides,
  })),
  buildConsentConfig: vi.fn((signals: string[]) => ({ signals })),
  getTag,
  listTags,
  listTriggers,
  updateTag,
}));

vi.mock("../lib/permission-guard.js", () => ({
  requireWriteAccess: vi.fn(),
}));

vi.mock("../lib/pre-fix-backup.js", () => ({
  createPreFixBackup: vi.fn(),
}));

const SECRET = "ya29.secret-token-material";

function googleApiError(): Error {
  return new Error(`Google API request failed: access_token=${SECRET}`);
}

describe("TOR-2134 fix-action error redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("redacts API errors in consent --fix action lines", async () => {
    const tag: GtmTag = {
      tagId: "7",
      name: "Ads Conversion",
      type: "awct",
      fingerprint: "f",
      firingTriggerId: ["1"],
    };
    listTags.mockResolvedValue([tag]);
    getTag.mockResolvedValue({ ...tag });
    updateTag.mockRejectedValue(googleApiError());

    const { fixConsentV2 } = await import("../tools/consent-audit.js");
    const result = await fixConsentV2(false);

    expect(result.errors).toBe(1);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toContain("[REDACTED]");
    expect(result.actions[0]).not.toContain(SECRET);
  });

  it("redacts API errors in fix-firing action lines", async () => {
    const tag: GtmTag = {
      tagId: "9",
      name: "SPA Page View",
      type: "gaawe",
      fingerprint: "g",
      firingTriggerId: ["5"],
    };
    const trigger: GtmTrigger = {
      triggerId: "5",
      name: "History Change",
      type: "HISTORY_CHANGE",
    };
    listTags.mockResolvedValue([tag]);
    listTriggers.mockResolvedValue([trigger]);
    getTag.mockResolvedValue({ ...tag });
    updateTag.mockRejectedValue(googleApiError());

    const { fixFiring } = await import("../tools/fix-firing.js");
    const result = await fixFiring(undefined, false);

    expect(result.errors).toBe(1);
    expect(result.actions).toHaveLength(1);
    expect(result.actions[0]).toContain("[REDACTED]");
    expect(result.actions[0]).not.toContain(SECRET);
  });
});
