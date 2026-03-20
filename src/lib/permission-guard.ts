import { loadConfig } from "./config.js";
import {
  getCurrentUserPermission,
  getEffectiveContainerPermission,
  isPermissionLookupError,
} from "./gtm-cli.js";
import type { GtmUserPermission } from "../types/gtm.js";
import { ErrorCode, TagOpsError } from "./errors.js";

export function describePermission(permission: GtmUserPermission, profileName?: string): string {
  const containerPermission = getEffectiveContainerPermission(
    permission,
    loadConfig(profileName).containerId,
  );
  return `account=${permission.accountAccess.permission}, container=${containerPermission}`;
}

export async function requireWriteAccess(profileName?: string): Promise<void> {
  try {
    const permission = await getCurrentUserPermission(profileName);
    if (!permission) return;

    const containerPermission = getEffectiveContainerPermission(
      permission,
      loadConfig(profileName).containerId,
    );
    if (
      containerPermission === "edit" ||
      containerPermission === "approve" ||
      containerPermission === "publish"
    ) {
      return;
    }

    const { containerId } = loadConfig(profileName);
    throw new TagOpsError({
      code: ErrorCode.API_FORBIDDEN,
      message: `Authenticated as ${permission.emailAddress} with ${describePermission(permission, profileName)} for container ${containerId}. This command requires container write access.`,
      suggestion:
        "Ask a GTM Account Admin to grant Edit, Approve, or Publish access to this container.",
    });
  } catch (err) {
    if (isPermissionLookupError(err)) return;
    throw err;
  }
}

export async function requirePublishAccess(profileName?: string): Promise<void> {
  try {
    const permission = await getCurrentUserPermission(profileName);
    if (!permission) return;

    const containerPermission = getEffectiveContainerPermission(
      permission,
      loadConfig(profileName).containerId,
    );
    if (containerPermission === "publish") return;

    const { containerId } = loadConfig(profileName);
    throw new TagOpsError({
      code: ErrorCode.API_FORBIDDEN,
      message: `Authenticated as ${permission.emailAddress} with ${describePermission(permission, profileName)} for container ${containerId}. Publishing requires container publish access.`,
      suggestion: "Ask a GTM Account Admin to grant Publish access to this container.",
    });
  } catch (err) {
    if (isPermissionLookupError(err)) return;
    throw err;
  }
}
