import { loadConfig } from "./config.js";
import { isServiceAccountAuth } from "./auth.js";
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

async function allowServiceAccountBypass(): Promise<boolean> {
  return isServiceAccountAuth();
}

function createUnverifiableAccessError(
  accessLevel: "write" | "publish",
  profileName?: string,
  cause?: unknown,
): TagOpsError {
  const { containerId } = loadConfig(profileName);
  const accessLabel = accessLevel === "publish" ? "publish" : "write";

  return new TagOpsError({
    code: ErrorCode.API_FORBIDDEN,
    message: `Unable to verify GTM container ${accessLabel} access for container ${containerId}. TagOps blocks this operation unless permission lookup succeeds or the current auth context is a service account.`,
    suggestion:
      accessLevel === "publish"
        ? "Re-run `tagops auth login` to grant the latest scopes, including `tagmanager.manage.users`, or use a service account with verified GTM publish access."
        : "Re-run `tagops auth login` to grant the latest scopes, including `tagmanager.manage.users`, or use a service account with verified GTM write access.",
    cause,
  });
}

export async function requireWriteAccess(profileName?: string): Promise<void> {
  try {
    const permission = await getCurrentUserPermission(profileName);
    if (!permission) {
      if (await allowServiceAccountBypass()) return;
      throw createUnverifiableAccessError("write", profileName);
    }

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
    if (isPermissionLookupError(err)) {
      if (await allowServiceAccountBypass()) return;
      throw createUnverifiableAccessError("write", profileName, err);
    }
    throw err;
  }
}

export async function requirePublishAccess(profileName?: string): Promise<void> {
  try {
    const permission = await getCurrentUserPermission(profileName);
    if (!permission) {
      if (await allowServiceAccountBypass()) return;
      throw createUnverifiableAccessError("publish", profileName);
    }

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
    if (isPermissionLookupError(err)) {
      if (await allowServiceAccountBypass()) return;
      throw createUnverifiableAccessError("publish", profileName, err);
    }
    throw err;
  }
}
