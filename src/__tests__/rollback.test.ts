import { beforeEach, describe, expect, it, vi } from "vitest";
import { listVersionHistory, rollback } from "../tools/rollback.js";
import * as gtmCli from "../lib/gtm-cli.js";
import * as permissionGuard from "../lib/permission-guard.js";
import type { GtmVersionHeader } from "../types/gtm.js";

vi.mock("../lib/gtm-cli.js", () => ({
  getLatestPublishedVersion: vi.fn(),
  getVersionDetails: vi.fn(),
  listVersions: vi.fn(),
  rollbackToVersion: vi.fn(),
}));

vi.mock("../lib/permission-guard.js", () => ({
  requirePublishAccess: vi.fn(),
}));

function makeVersion(overrides: Partial<GtmVersionHeader> = {}): GtmVersionHeader {
  return {
    containerVersionId: "1",
    name: "Release 1",
    description: "Initial release",
    numTags: "1",
    numTriggers: "1",
    numVariables: "1",
    path: "accounts/1/containers/2/versions/1",
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("listVersionHistory", () => {
  it("returns version entries with live markers and detail formatting", async () => {
    vi.mocked(gtmCli.listVersions).mockResolvedValue([
      makeVersion({ containerVersionId: "12", name: "Release 12", path: "versions/12" }),
      makeVersion({ containerVersionId: "11", name: "Release 11", path: "versions/11" }),
      makeVersion({ containerVersionId: "10", name: "Release 10", path: "versions/10" }),
    ]);
    vi.mocked(gtmCli.getLatestPublishedVersion).mockResolvedValue(
      makeVersion({ containerVersionId: "11", name: "Release 11", path: "versions/11" }),
    );
    vi.mocked(gtmCli.getVersionDetails).mockImplementation(async (versionId) => {
      if (versionId === "12") {
        return makeVersion({
          containerVersionId: "12",
          name: "Release 12",
          description: "Promoted to staging",
          numTags: "14",
          numTriggers: "8",
          numVariables: "5",
          path: "versions/12",
        });
      }

      if (versionId === "11") {
        return makeVersion({
          containerVersionId: "11",
          name: "Release 11",
          description: "Current live version",
          numTags: "13",
          numTriggers: "8",
          numVariables: "5",
          path: "versions/11",
        });
      }

      return null;
    });

    const result = await listVersionHistory(2.8);

    expect(result).toMatchObject({
      limit: 2,
      liveVersionId: "11",
      publishDatesAvailable: false,
    });
    expect(result.versions).toEqual([
      expect.objectContaining({
        containerVersionId: "12",
        name: "Release 12",
        description: "Promoted to staging",
        numTags: "14",
        isLive: false,
        publishedAt: undefined,
      }),
      expect.objectContaining({
        containerVersionId: "11",
        name: "Release 11",
        description: "Current live version",
        numTags: "13",
        isLive: true,
        publishedAt: undefined,
      }),
    ]);
    expect(gtmCli.getVersionDetails).toHaveBeenCalledTimes(2);
    expect(gtmCli.getVersionDetails).not.toHaveBeenCalledWith("10");
  });
});

describe("rollback", () => {
  it("does not publish in dry-run mode", async () => {
    vi.mocked(gtmCli.getVersionDetails).mockResolvedValue(
      makeVersion({
        containerVersionId: "42",
        name: "Rollback Target",
        description: "Known good release",
        numTags: "9",
        numTriggers: "4",
        numVariables: "3",
        path: "versions/42",
      }),
    );
    vi.mocked(gtmCli.getLatestPublishedVersion).mockResolvedValue(
      makeVersion({
        containerVersionId: "51",
        name: "Current Live",
        description: "Broken release",
        numTags: "10",
        numTriggers: "5",
        numVariables: "3",
        path: "versions/51",
      }),
    );

    const result = await rollback("42", { dryRun: true });

    expect(permissionGuard.requirePublishAccess).not.toHaveBeenCalled();
    expect(gtmCli.rollbackToVersion).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      dryRun: true,
      versionId: "42",
      published: false,
      targetVersion: expect.objectContaining({
        containerVersionId: "42",
        name: "Rollback Target",
      }),
      currentLiveVersion: expect.objectContaining({
        containerVersionId: "51",
        name: "Current Live",
      }),
    });
    expect(result.changes.some((change) => change.changed)).toBe(true);
    expect(result.error).toBeUndefined();
  });
});
