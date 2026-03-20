import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireWriteAccess } from "../lib/permission-guard.js";
import { ErrorCode } from "../lib/errors.js";
import type { GtmUserPermission } from "../types/gtm.js";

const {
  loadConfig,
  getCurrentUserPermission,
  getEffectiveContainerPermission,
  isPermissionLookupError,
} = vi.hoisted(() => ({
  loadConfig: vi.fn(),
  getCurrentUserPermission: vi.fn(),
  getEffectiveContainerPermission: vi.fn(),
  isPermissionLookupError: vi.fn(),
}));

vi.mock("../lib/config.js", () => ({
  loadConfig,
}));

vi.mock("../lib/gtm-cli.js", () => ({
  getCurrentUserPermission,
  getEffectiveContainerPermission,
  isPermissionLookupError,
}));

function makePermission(): GtmUserPermission {
  return {
    emailAddress: "tester@example.com",
    accountAccess: { permission: "user" },
    containerAccess: [{ containerId: "container-123", permission: "read" }],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  loadConfig.mockReturnValue({ containerId: "container-123" });
  isPermissionLookupError.mockReturnValue(false);
});

describe("requireWriteAccess", () => {
  it("passes when the user has edit permission", async () => {
    getCurrentUserPermission.mockResolvedValue(makePermission());
    getEffectiveContainerPermission.mockReturnValue("edit");

    await expect(requireWriteAccess()).resolves.toBeUndefined();
  });

  it("passes when the user has publish permission", async () => {
    getCurrentUserPermission.mockResolvedValue(makePermission());
    getEffectiveContainerPermission.mockReturnValue("publish");

    await expect(requireWriteAccess()).resolves.toBeUndefined();
  });

  it("throws when the user only has read permission", async () => {
    getCurrentUserPermission.mockResolvedValue(makePermission());
    getEffectiveContainerPermission.mockReturnValue("read");

    await expect(requireWriteAccess()).rejects.toMatchObject({
      name: "TagOpsError",
      code: ErrorCode.API_FORBIDDEN,
      message: expect.stringContaining("requires container write access"),
    });
  });

  it("swallows permission lookup API errors", async () => {
    const lookupError = new Error("permission lookup failed");
    getCurrentUserPermission.mockRejectedValue(lookupError);
    isPermissionLookupError.mockImplementation((err: unknown) => err === lookupError);

    await expect(requireWriteAccess()).resolves.toBeUndefined();
    expect(isPermissionLookupError).toHaveBeenCalledWith(lookupError);
  });
});
