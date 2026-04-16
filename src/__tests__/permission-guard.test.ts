import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireWriteAccess } from "../lib/permission-guard.js";
import { ErrorCode } from "../lib/errors.js";
import type { GtmUserPermission } from "../types/gtm.js";

const { isServiceAccountAuth } = vi.hoisted(() => ({
  isServiceAccountAuth: vi.fn(),
}));

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

vi.mock("../lib/auth.js", () => ({
  isServiceAccountAuth,
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
  isServiceAccountAuth.mockResolvedValue(false);
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

  it("blocks when permission lookup cannot be verified", async () => {
    const lookupError = new Error("permission lookup failed");
    getCurrentUserPermission.mockRejectedValue(lookupError);
    isPermissionLookupError.mockImplementation((err: unknown) => err === lookupError);

    await expect(requireWriteAccess()).rejects.toMatchObject({
      name: "TagOpsError",
      code: ErrorCode.API_FORBIDDEN,
      message: expect.stringContaining("Unable to verify GTM container write access"),
    });
    expect(isPermissionLookupError).toHaveBeenCalledWith(lookupError);
  });

  it("allows permission lookup failures for service account auth", async () => {
    const lookupError = new Error("permission lookup failed");
    getCurrentUserPermission.mockRejectedValue(lookupError);
    isPermissionLookupError.mockImplementation((err: unknown) => err === lookupError);
    isServiceAccountAuth.mockResolvedValue(true);

    await expect(requireWriteAccess()).resolves.toBeUndefined();
  });

  it("blocks when the authenticated identity cannot be matched to a GTM permission", async () => {
    getCurrentUserPermission.mockResolvedValue(null);

    await expect(requireWriteAccess()).rejects.toMatchObject({
      name: "TagOpsError",
      code: ErrorCode.API_FORBIDDEN,
      message: expect.stringContaining("Unable to verify GTM container write access"),
    });
  });

  it("allows unmatched GTM permissions for service account auth", async () => {
    getCurrentUserPermission.mockResolvedValue(null);
    isServiceAccountAuth.mockResolvedValue(true);

    await expect(requireWriteAccess()).resolves.toBeUndefined();
  });
});
