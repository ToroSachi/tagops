/**
 * GTM API Wrapper — direct interface to @googleapis/tagmanager
 *
 * Replaces the legacy Python CLI wrapper. Now makes direct network calls
 * using App Default Credentials or Local OAuth flow.
 * Every script and the MCP server imports from here — single source of truth.
 */

import { tagmanager } from "@googleapis/tagmanager";
import type { tagmanager_v2 } from "@googleapis/tagmanager";
import crypto from "node:crypto";
import { getAuthClient, getCurrentAuthenticatedEmail } from "./auth.js";
import { configureApiConcurrency, getApiSemaphore } from "./concurrency.js";
import { loadConfig, ConfigError } from "./config.js";
import { getTagOpsId } from "./identity.js";
import { getSafeErrorMessage } from "./redaction.js";
import type {
  GtmAccountAccess,
  GtmBuiltInVariable,
  GtmClient,
  GtmConsentSignalInput,
  GtmConsentSignalValue,
  GtmContainerAccess,
  GtmContainerPermission,
  GtmConsentSettings,
  GtmEnvironment,
  GtmFolder,
  GtmParameter,
  GtmTag,
  GtmTrigger,
  GtmTransformation,
  GtmUserPermission,
  GtmVariable,
  GtmVersionHeader,
} from "../types/gtm.js";
import { TagOpsError, ErrorCode } from "./errors.js";

// ── API Factory & Helpers ──

configureApiConcurrency();

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function coerceArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function getNextPageToken(
  data: { nextPageToken?: string | null } | null | undefined,
): string | undefined {
  return typeof data?.nextPageToken === "string" && data.nextPageToken.length > 0
    ? data.nextPageToken
    : undefined;
}

function getFingerprint(
  data: { fingerprint?: string | null } | null | undefined,
): string | undefined {
  return typeof data?.fingerprint === "string" && data.fingerprint.length > 0
    ? data.fingerprint
    : undefined;
}

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  return getApiSemaphore().use(async () => {
    let attempt = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        return await operation();
      } catch (err: unknown) {
        const error = err as { response?: { status?: number } };
        const status = error.response?.status;
        if ((status === 429 || (status && status >= 500)) && attempt < maxRetries) {
          attempt++;
          const backoffMs = Math.pow(2, attempt) * 1000 + Math.random() * 1000;
          console.warn(
            `[API] Rate limited or transient error (Status ${status}). Retrying attempt ${attempt}/${maxRetries} in ${Math.round(backoffMs)}ms...`,
          );
          await delay(backoffMs);
          continue;
        }
        throw err;
      }
    }
  });
}

export async function getGtmClient(_profileName?: string) {
  const auth = await getAuthClient();
  // Type assertion at library boundary — our auth types are runtime-compatible with googleapis
  return tagmanager({
    version: "v2",
    auth: auth as unknown as Parameters<typeof tagmanager>[0]["auth"],
  });
}

export function getWorkspacePath(profileName?: string): string {
  const config = loadConfig(profileName);
  return `accounts/${config.accountId}/containers/${config.containerId}/workspaces/${config.workspaceId}`;
}

export function getContainerPath(profileName?: string): string {
  const config = loadConfig(profileName);
  return `accounts/${config.accountId}/containers/${config.containerId}`;
}

export interface GtmContainerMetadata {
  accountId?: string;
  containerId?: string;
  features?: {
    supportBuiltInVariables?: boolean | null;
    supportClients?: boolean | null;
    supportEnvironments?: boolean | null;
    supportFolders?: boolean | null;
    supportTags?: boolean | null;
    supportTransformations?: boolean | null;
    supportTriggers?: boolean | null;
    supportVariables?: boolean | null;
  } | null;
  name?: string;
  notes?: string;
  path?: string;
  publicId?: string;
  taggingServerUrls?: string[];
  usageContext?: string[];
}

function getAccountPath(profileName?: string): string {
  const config = loadConfig(profileName);
  return `accounts/${config.accountId}`;
}

function isNetworkConnectionError(err: unknown): boolean {
  const error = err as {
    code?: string;
    message?: string;
    cause?: { code?: string; message?: string };
  };
  const code = error.code ?? error.cause?.code ?? "";
  const message = `${error.message ?? ""} ${error.cause?.message ?? ""}`.toLowerCase();

  return (
    [
      "ECONNRESET",
      "ECONNREFUSED",
      "ETIMEDOUT",
      "ENOTFOUND",
      "EAI_AGAIN",
      "ENETUNREACH",
      "EHOSTUNREACH",
      "UND_ERR_CONNECT_TIMEOUT",
    ].includes(code) ||
    message.includes("network") ||
    message.includes("socket") ||
    message.includes("timed out") ||
    message.includes("getaddrinfo") ||
    message.includes("econn") ||
    message.includes("enotfound")
  );
}

async function handleApiError(err: unknown, operation: string): Promise<never> {
  if (
    err instanceof ConfigError ||
    (err instanceof Error && err.message.includes("No .gtmrc.json found"))
  ) {
    throw err;
  }
  const error = err as {
    response?: { status?: number; data?: { error?: { message?: string } } };
    message?: string;
  };
  const statusCode = error.response?.status;

  if (statusCode === 409) {
    throw new TagOpsError({
      code: ErrorCode.API_FORBIDDEN,
      message: `Conflict detected in ${operation}. GTM resource was modified elsewhere.`,
      suggestion: "Please re-run the command or check the GTM UI.",
    });
  }

  const details = getSafeErrorMessage(
    error.response?.data?.error?.message ?? error.message,
    "Unknown error",
  );
  throw new TagOpsError({
    code: ErrorCode.INTERNAL_ERROR,
    message: `GTM API failed during ${operation}: ${details}`,
  });
}

function isUnsupportedWorkspaceFeatureError(err: unknown): boolean {
  const error = err as {
    response?: { status?: number; data?: { error?: { message?: string } } };
    message?: string;
  };
  if (error.response?.status !== 400) return false;

  const details = (error.response?.data?.error?.message || error.message || "").toLowerCase();

  return (
    details.includes("not supported") ||
    details.includes("unsupported") ||
    details.includes("does not support")
  );
}

function normalizeAccountPermission(permission?: string | null): GtmAccountAccess["permission"] {
  switch (permission) {
    case "admin":
    case "user":
    case "read":
    case "noAccess":
      return permission;
    default:
      return "noAccess";
  }
}

function normalizeContainerPermission(
  permission?: string | null,
): GtmContainerAccess["permission"] {
  switch (permission) {
    case "publish":
    case "approve":
    case "edit":
    case "read":
    case "noAccess":
      return permission;
    case "admin":
      return "publish";
    case "user":
      return "edit";
    default:
      return "noAccess";
  }
}

function mapUserPermission(
  permission: tagmanager_v2.Schema$UserPermission,
): GtmUserPermission | null {
  const emailAddress = permission.emailAddress?.trim();
  if (!emailAddress) return null;

  return {
    emailAddress: emailAddress.toLowerCase(),
    accountAccess: {
      permission: normalizeAccountPermission(permission.accountAccess?.permission),
    },
    containerAccess: (permission.containerAccess ?? [])
      .map((access) => {
        const containerId = access.containerId?.trim();
        if (!containerId) return null;

        return {
          containerId,
          permission: normalizeContainerPermission(access.permission),
        };
      })
      .filter((access): access is GtmContainerAccess => access !== null),
  };
}

async function handlePermissionLookupError(err: unknown, operation: string): Promise<never> {
  const error = err as {
    response?: { status?: number };
  };

  if (error.response?.status === 403) {
    throw new TagOpsError({
      code: ErrorCode.API_FORBIDDEN,
      message: "Unable to inspect GTM user permissions with the current credentials.",
      suggestion:
        "Re-run `tagops auth login` to grant the latest scopes, including `tagmanager.manage.users`, or ask an Account Admin to verify your GTM access.",
      cause: err,
    });
  }

  return handleApiError(err, operation);
}

export function isPermissionLookupError(err: unknown): boolean {
  return (
    err instanceof TagOpsError &&
    err.code === ErrorCode.API_FORBIDDEN &&
    err.message.includes("inspect GTM user permissions")
  );
}

export async function listUserPermissions(profileName?: string): Promise<GtmUserPermission[]> {
  try {
    const parent = getAccountPath(profileName);
    const cacheKey = `userPermissions:${parent}`;
    const cached = getCached<GtmUserPermission[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const permissions: GtmUserPermission[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.user_permissions.list({
          parent,
          pageToken,
        }),
      );

      permissions.push(
        ...coerceArray<tagmanager_v2.Schema$UserPermission>(res.data?.userPermission)
          .map((permission) => mapUserPermission(permission))
          .filter((permission): permission is GtmUserPermission => permission !== null),
      );
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, permissions);
    return permissions;
  } catch (err) {
    return handlePermissionLookupError(err, "listUserPermissions");
  }
}

export async function getCurrentUserPermission(
  profileName?: string,
): Promise<GtmUserPermission | null> {
  const emailAddress = await getCurrentAuthenticatedEmail();
  if (!emailAddress) return null;

  const permissions = await listUserPermissions(profileName);
  return permissions.find((permission) => permission.emailAddress === emailAddress) ?? null;
}

export function getEffectiveContainerPermission(
  permission: GtmUserPermission,
  containerId = loadConfig().containerId,
): GtmContainerPermission {
  const directPermission = permission.containerAccess.find(
    (access) => access.containerId === containerId,
  )?.permission;

  if (directPermission) return directPermission;

  if (permission.accountAccess.permission === "admin") {
    return "publish";
  }

  if (permission.accountAccess.permission === "read") {
    return "read";
  }

  return "noAccess";
}

export async function checkWriteAccess(profileName?: string): Promise<boolean> {
  try {
    const permission = await getCurrentUserPermission(profileName);
    if (!permission) return false;

    const effectivePermission = getEffectiveContainerPermission(
      permission,
      loadConfig(profileName).containerId,
    );
    return (
      effectivePermission === "edit" ||
      effectivePermission === "approve" ||
      effectivePermission === "publish"
    );
  } catch (err) {
    if (isPermissionLookupError(err)) return false;
    throw err;
  }
}

export async function checkPublishAccess(profileName?: string): Promise<boolean> {
  try {
    const permission = await getCurrentUserPermission(profileName);
    if (!permission) return false;

    return (
      getEffectiveContainerPermission(permission, loadConfig(profileName).containerId) === "publish"
    );
  } catch (err) {
    if (isPermissionLookupError(err)) return false;
    throw err;
  }
}

export async function listWorkspaces(
  profileName?: string,
): Promise<Array<{ workspaceId: string; name: string }>> {
  try {
    const config = loadConfig(profileName);
    const parent = `accounts/${config.accountId}/containers/${config.containerId}`;
    const gtm = await getGtmClient(profileName);
    const workspaces: Array<{ workspaceId: string; name: string }> = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.list({ parent, pageToken }),
      );
      const page = coerceArray<{ workspaceId?: string; name?: string }>(res.data?.workspace);
      workspaces.push(
        ...page.map((w) => ({
          workspaceId: w.workspaceId as string,
          name: w.name as string,
        })),
      );
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    return workspaces;
  } catch (err) {
    return handleApiError(err, "listWorkspaces");
  }
}

export interface WorkspaceStatus {
  synced: boolean;
  mergeConflict: tagmanager_v2.Schema$MergeConflict[];
  workspaceChange: tagmanager_v2.Schema$Entity[];
}

export type WorkspaceConflictResolution =
  | { tag: GtmTag | tagmanager_v2.Schema$Tag }
  | { trigger: GtmTrigger | tagmanager_v2.Schema$Trigger }
  | { variable: GtmVariable | tagmanager_v2.Schema$Variable };

export async function getWorkspaceStatus(profileName?: string): Promise<WorkspaceStatus> {
  try {
    const path = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const res = await withRetry(() => gtm.accounts.containers.workspaces.getStatus({ path }));
    const mergeConflict = coerceArray<tagmanager_v2.Schema$MergeConflict>(res.data?.mergeConflict);
    const workspaceChange = coerceArray<tagmanager_v2.Schema$Entity>(res.data?.workspaceChange);

    return {
      synced: mergeConflict.length === 0 && workspaceChange.length === 0,
      mergeConflict,
      workspaceChange,
    };
  } catch (err) {
    return handleApiError(err, "getWorkspaceStatus");
  }
}

export async function syncWorkspace(
  profileName?: string,
): Promise<tagmanager_v2.Schema$SyncWorkspaceResponse> {
  try {
    const path = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const res = await withRetry(() => gtm.accounts.containers.workspaces.sync({ path }));
    apiCache.clear();
    return res.data;
  } catch (err) {
    return handleApiError(err, "syncWorkspace");
  }
}

export async function resolveWorkspaceConflict(
  entity: WorkspaceConflictResolution,
  fingerprint?: string,
  profileName?: string,
): Promise<boolean> {
  try {
    const path = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const requestBody: tagmanager_v2.Schema$Entity =
      "tag" in entity
        ? { tag: entity.tag as tagmanager_v2.Schema$Tag }
        : "trigger" in entity
          ? { trigger: entity.trigger as tagmanager_v2.Schema$Trigger }
          : { variable: entity.variable as tagmanager_v2.Schema$Variable };

    await withRetry(() =>
      gtm.accounts.containers.workspaces.resolve_conflict({
        path,
        fingerprint,
        requestBody,
      }),
    );

    apiCache.clear();
    return true;
  } catch (err) {
    return handleApiError(err, "resolveWorkspaceConflict");
  }
}

export async function createWorkspace(
  name: string,
  description?: string,
  profileName?: string,
): Promise<tagmanager_v2.Schema$Workspace> {
  if (!name)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Workspace name is required",
    });

  try {
    const parent = getContainerPath(profileName);
    const gtm = await getGtmClient(profileName);
    const requestBody: tagmanager_v2.Schema$Workspace = { name };
    if (description) requestBody.description = description;

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.create({
        parent,
        requestBody,
      }),
    );

    apiCache.clear();
    return res.data;
  } catch (err) {
    return handleApiError(err, "createWorkspace");
  }
}

export async function deleteWorkspace(workspaceId: string, profileName?: string): Promise<boolean> {
  if (!workspaceId) return false;

  try {
    const config = loadConfig(profileName);
    const path = `accounts/${config.accountId}/containers/${config.containerId}/workspaces/${workspaceId}`;
    const gtm = await getGtmClient(profileName);

    await withRetry(() => gtm.accounts.containers.workspaces.delete({ path }));

    apiCache.clear();
    return true;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return false;
    return handleApiError(err, "deleteWorkspace");
  }
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}
const apiCache = new Map<string, CacheEntry<any>>();
const CACHE_TTL_MS = 5000;

function getCached<T>(key: string): T | null {
  const entry = apiCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) return entry.data as T;
  return null;
}

function setCache<T>(key: string, data: T) {
  apiCache.set(key, { data, timestamp: Date.now() });
}

/** Flush the API response cache. Exposed for test teardown. */
export function clearApiCache(): void {
  apiCache.clear();
}

// ── Typed resource accessors ──

async function fetchContainer(profileName?: string): Promise<GtmContainerMetadata> {
  const path = getContainerPath(profileName);
  const cacheKey = `container:${path}`;
  const cached = getCached<GtmContainerMetadata>(cacheKey);
  if (cached) return cached;

  const gtm = await getGtmClient(profileName);
  const res = await withRetry(() => gtm.accounts.containers.get({ path }));
  const container = (res.data ?? {}) as GtmContainerMetadata;

  setCache(cacheKey, container);
  return container;
}

export async function getContainer(profileName?: string): Promise<GtmContainerMetadata> {
  try {
    return await fetchContainer(profileName);
  } catch (err) {
    return handleApiError(err, "getContainer");
  }
}

export async function verifyGtmConnection(profileName?: string): Promise<GtmContainerMetadata> {
  try {
    return await fetchContainer(profileName);
  } catch (err) {
    const error = err as { response?: { status?: number } };
    const statusCode = error.response?.status;

    if (statusCode === 401 || statusCode === 403) {
      throw new TagOpsError({
        code: ErrorCode.API_FORBIDDEN,
        message: "Cannot verify GTM access with the current credentials.",
        suggestion:
          "Run `tagops auth login` to refresh credentials and confirm the configured account can access this GTM container.",
        cause: err,
      });
    }

    if (isNetworkConnectionError(err)) {
      throw new TagOpsError({
        code: ErrorCode.INTERNAL_ERROR,
        message: "Cannot reach the GTM API to verify this workspace connection.",
        suggestion:
          "Check network connectivity, proxy settings, and whether the Google Tag Manager API is reachable from this environment.",
        cause: err,
      });
    }

    return handleApiError(err, "verifyGtmConnection");
  }
}

export async function listTags(profileName?: string): Promise<GtmTag[]> {
  try {
    const parent = getWorkspacePath(profileName);
    const cacheKey = `tags:${parent}`;
    const cached = getCached<GtmTag[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const allTags: GtmTag[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.tags.list({
          parent,
          pageToken,
        }),
      );
      const tags = coerceArray<GtmTag>(res.data?.tag);
      allTags.push(...tags);
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, allTags);
    return allTags;
  } catch (err) {
    return handleApiError(err, "listTags");
  }
}

export async function getTag(tagId: string, profileName?: string): Promise<GtmTag | null> {
  if (!tagId || tagId.trim().length === 0) return null;
  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.tags.get({ path: `${parent}/tags/${tagId}` }),
    );
    return (res.data ?? null) as GtmTag | null;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return null;
    return handleApiError(err, "getTag");
  }
}

export async function listTriggers(profileName?: string): Promise<GtmTrigger[]> {
  try {
    const parent = getWorkspacePath(profileName);
    const cacheKey = `triggers:${parent}`;
    const cached = getCached<GtmTrigger[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const allTriggers: GtmTrigger[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.triggers.list({
          parent,
          pageToken,
        }),
      );
      const triggers = coerceArray<GtmTrigger>(res.data?.trigger);
      allTriggers.push(...triggers);
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, allTriggers);
    return allTriggers;
  } catch (err) {
    return handleApiError(err, "listTriggers");
  }
}

export async function getTrigger(
  triggerId: string,
  profileName?: string,
): Promise<GtmTrigger | null> {
  if (!triggerId || triggerId.trim().length === 0) return null;
  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.triggers.get({ path: `${parent}/triggers/${triggerId}` }),
    );
    return (res.data ?? null) as GtmTrigger | null;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return null;
    return handleApiError(err, "getTrigger");
  }
}

export async function listVariables(profileName?: string): Promise<GtmVariable[]> {
  try {
    const parent = getWorkspacePath(profileName);
    const cacheKey = `variables:${parent}`;
    const cached = getCached<GtmVariable[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const allVariables: GtmVariable[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.variables.list({
          parent,
          pageToken,
        }),
      );
      const variables = coerceArray<GtmVariable>(res.data?.variable);
      allVariables.push(...variables);
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, allVariables);
    return allVariables;
  } catch (err) {
    return handleApiError(err, "listVariables");
  }
}

export async function listClients(profileName?: string): Promise<GtmClient[]> {
  try {
    const parent = getWorkspacePath(profileName);
    const cacheKey = `clients:${parent}`;
    const cached = getCached<GtmClient[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const allClients: GtmClient[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.clients.list({
          parent,
          pageToken,
        }),
      );
      const clients = coerceArray<GtmClient>(res.data?.client);
      allClients.push(...clients);
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, allClients);
    return allClients;
  } catch (err) {
    if (isUnsupportedWorkspaceFeatureError(err)) return [];
    return handleApiError(err, "listClients");
  }
}

export async function listTransformations(profileName?: string): Promise<GtmTransformation[]> {
  try {
    const parent = getWorkspacePath(profileName);
    const cacheKey = `transformations:${parent}`;
    const cached = getCached<GtmTransformation[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const allTransformations: GtmTransformation[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.transformations.list({
          parent,
          pageToken,
        }),
      );
      const transformations = coerceArray<GtmTransformation>(res.data?.transformation);
      allTransformations.push(...transformations);
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, allTransformations);
    return allTransformations;
  } catch (err) {
    if (isUnsupportedWorkspaceFeatureError(err)) return [];
    return handleApiError(err, "listTransformations");
  }
}

export async function listFolders(profileName?: string): Promise<GtmFolder[]> {
  try {
    const parent = getWorkspacePath(profileName);
    const cacheKey = `folders:${parent}`;
    const cached = getCached<GtmFolder[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const allFolders: GtmFolder[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.folders.list({
          parent,
          pageToken,
        }),
      );
      const folders = coerceArray<GtmFolder>(res.data?.folder);
      allFolders.push(...folders);
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, allFolders);
    return allFolders;
  } catch (err) {
    return handleApiError(err, "listFolders");
  }
}

export async function listBuiltInVariables(profileName?: string): Promise<GtmBuiltInVariable[]> {
  try {
    const parent = getWorkspacePath(profileName);
    const cacheKey = `builtInVariables:${parent}`;
    const cached = getCached<GtmBuiltInVariable[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const allBuiltInVariables: GtmBuiltInVariable[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.built_in_variables.list({
          parent,
          pageToken,
        }),
      );
      const builtInVariables = coerceArray<GtmBuiltInVariable>(res.data?.builtInVariable);
      allBuiltInVariables.push(...builtInVariables);
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, allBuiltInVariables);
    return allBuiltInVariables;
  } catch (err) {
    return handleApiError(err, "listBuiltInVariables");
  }
}

export async function listEnvironments(profileName?: string): Promise<GtmEnvironment[]> {
  try {
    const parent = getContainerPath(profileName);
    const cacheKey = `environments:${parent}`;
    const cached = getCached<GtmEnvironment[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const allEnvironments: GtmEnvironment[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.environments.list({
          parent,
          pageToken,
        }),
      );
      const environments = coerceArray<GtmEnvironment>(res.data?.environment);
      allEnvironments.push(...environments);
      pageToken = getNextPageToken(res.data);
    } while (pageToken);

    setCache(cacheKey, allEnvironments);
    return allEnvironments;
  } catch (err) {
    return handleApiError(err, "listEnvironments");
  }
}

// ── Folder operations ──

export async function createFolder(
  name: string,
  config: Record<string, unknown>,
  profileName?: string,
): Promise<GtmFolder | null> {
  if (!name)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Folder name is required",
    });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const existingNotes = config.notes ? String(config.notes) : "";
    const hasUUID = Boolean(getTagOpsId(existingNotes));
    const uuid = hasUUID ? "" : crypto.randomUUID();
    const notesValue = hasUUID
      ? existingNotes
      : `${existingNotes}${existingNotes ? "\n" : ""}TagOps-ID: ${uuid}`;
    const requestBody: Record<string, unknown> = {
      name,
      ...config,
      notes: notesValue,
    };

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.folders.create({
        parent,
        requestBody,
      }),
    );

    apiCache.clear();
    return (res.data ?? null) as GtmFolder | null;
  } catch (err: unknown) {
    const error = err as {
      response?: { status?: number; data?: { error?: { message?: string } } };
    };
    if (
      error.response?.status === 400 &&
      error.response?.data?.error?.message?.toLowerCase().includes("duplicate name")
    ) {
      console.warn(`  [Skipped] Folder already exists: "${name}"`);
      apiCache.delete(`folders:${getWorkspacePath(profileName)}`);
      const existing = (await listFolders(profileName)).find((folder) => folder.name === name);
      if (existing) {
        return existing;
      }
    }
    return handleApiError(err, "createFolder");
  }
}

export async function updateFolder(
  folderId: string,
  requestBody: Record<string, unknown>,
  profileName?: string,
): Promise<GtmFolder | null> {
  if (!folderId)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Folder ID is required",
    });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const path = `${parent}/folders/${folderId}`;

    const current = await withRetry(() => gtm.accounts.containers.workspaces.folders.get({ path }));
    const fingerprint = getFingerprint(current.data);

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.folders.update({
        path,
        fingerprint,
        requestBody,
      }),
    );

    apiCache.clear();
    return (res.data ?? null) as GtmFolder | null;
  } catch (err) {
    return handleApiError(err, "updateFolder");
  }
}

// ── Tag operations ──

export interface CreateTagInput {
  name: string;
  type: string;
  firingTriggerId?: string | string[];
  config: Record<string, unknown>;
}

export interface CreateTagResult {
  created: boolean;
  duplicate: boolean;
  tag?: GtmTag;
  rawResponse?: string;
}

function normalizeFiringTriggerIds(
  firingTriggerId: string | string[] | undefined,
): string[] | undefined {
  if (firingTriggerId === undefined) return undefined;

  if (typeof firingTriggerId === "string") {
    const triggerIds = firingTriggerId
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);

    if (triggerIds.length === 0) {
      throw new TagOpsError({
        code: ErrorCode.VALIDATION_FAILED,
        message: "Firing trigger ID is required",
      });
    }

    return triggerIds;
  }

  return firingTriggerId;
}

export async function createTag(
  input: CreateTagInput,
  profileName?: string,
): Promise<CreateTagResult> {
  if (!input.name)
    throw new TagOpsError({ code: ErrorCode.VALIDATION_FAILED, message: "Tag name is required" });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const firingTriggerId = normalizeFiringTriggerIds(input.firingTriggerId);
    const existingNotes = input.config.notes ? String(input.config.notes) : "";
    // Only inject UUID if one isn't already present (prevents duplicates on re-sync)
    const hasUUID = Boolean(getTagOpsId(existingNotes));
    const uuid = hasUUID ? "" : crypto.randomUUID();
    const notesValue = hasUUID
      ? existingNotes
      : `${existingNotes}${existingNotes ? "\n" : ""}TagOps-ID: ${uuid}`;
    const requestBody = normalizeTagRequestBody({
      name: input.name,
      type: input.type,
      ...input.config,
      notes: notesValue,
    });

    if (firingTriggerId) {
      requestBody.firingTriggerId = firingTriggerId;
    }

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.tags.create({
        parent,
        requestBody,
      }),
    );

    apiCache.clear();
    const tag = (res.data ?? null) as GtmTag | null;
    return {
      created: true,
      duplicate: false,
      tag: tag ?? undefined,
      rawResponse: JSON.stringify(res.data, null, 2),
    };
  } catch (err: unknown) {
    const error = err as {
      response?: { status?: number; data?: { error?: { message?: string } } };
    };
    if (
      error.response?.status === 400 &&
      error.response?.data?.error?.message?.toLowerCase().includes("duplicate name")
    ) {
      console.warn(`  [Skipped] Tag already exists: "${input.name}"`);
      const existing = (await listTags(profileName)).find((tag) => tag.name === input.name);
      return {
        created: false,
        duplicate: true,
        tag: existing,
        rawResponse: JSON.stringify(existing ?? { name: input.name, duplicate: true }, null, 2),
      };
    }
    return handleApiError(err, "createTag");
  }
}

export interface UpdateTagInput {
  tagId: string;
  name: string;
  fingerprint: string;
  config: Record<string, unknown>;
  firingTriggerId?: string | string[];
}

const READ_ONLY_TAG_FIELDS = [
  "accountId",
  "containerId",
  "workspaceId",
  "path",
  "tagId",
  "fingerprint",
  "tagManagerUrl",
] as const;

function normalizeTagRequestBody(requestBody: Record<string, unknown>): Record<string, unknown> {
  const normalized = structuredClone(requestBody) as Record<string, unknown>;

  if (
    normalized.tagFiringOption === undefined &&
    typeof normalized.firingOption === "string" &&
    normalized.firingOption.length > 0
  ) {
    normalized.tagFiringOption = normalized.firingOption;
  }

  delete normalized.firingOption;
  return normalized;
}

/**
 * GTM tags.update fully replaces the tag resource, so callers must provide
 * the complete tag body with only read-only API fields removed.
 */
export function buildCompleteTagConfig(
  tag: object,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const requestBody = normalizeTagRequestBody({
    ...(structuredClone(tag) as Record<string, unknown>),
    ...overrides,
  });

  for (const field of READ_ONLY_TAG_FIELDS) {
    delete requestBody[field];
  }

  for (const [key, value] of Object.entries(requestBody)) {
    if (value === undefined) {
      delete requestBody[key];
    }
  }

  return requestBody;
}

export async function updateTag(input: UpdateTagInput, profileName?: string): Promise<string> {
  if (!input.tagId)
    throw new TagOpsError({ code: ErrorCode.VALIDATION_FAILED, message: "Tag ID is required" });
  if (!input.fingerprint)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Fingerprint is required for updates",
    });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const firingTriggerId = normalizeFiringTriggerIds(input.firingTriggerId);

    const requestBody = normalizeTagRequestBody({
      name: input.name,
      fingerprint: input.fingerprint,
      ...input.config,
    });

    if (firingTriggerId) {
      requestBody.firingTriggerId = firingTriggerId;
    }

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.tags.update({
        path: `${parent}/tags/${input.tagId}`,
        requestBody,
      }),
    );

    apiCache.clear();
    return JSON.stringify(res.data, null, 2);
  } catch (err) {
    return handleApiError(err, "updateTag");
  }
}

// ── Delete operations ──

export async function deleteTag(tagId: string, profileName?: string): Promise<boolean> {
  if (!tagId) return false;
  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    await withRetry(() =>
      gtm.accounts.containers.workspaces.tags.delete({ path: `${parent}/tags/${tagId}` }),
    );
    apiCache.clear();
    return true;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return false;
    return handleApiError(err, "deleteTag");
  }
}

export async function deleteTrigger(triggerId: string, profileName?: string): Promise<boolean> {
  if (!triggerId) return false;
  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    await withRetry(() =>
      gtm.accounts.containers.workspaces.triggers.delete({
        path: `${parent}/triggers/${triggerId}`,
      }),
    );
    apiCache.clear();
    return true;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return false;
    return handleApiError(err, "deleteTrigger");
  }
}

export async function deleteVariable(variableId: string, profileName?: string): Promise<boolean> {
  if (!variableId) return false;
  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    await withRetry(() =>
      gtm.accounts.containers.workspaces.variables.delete({
        path: `${parent}/variables/${variableId}`,
      }),
    );
    apiCache.clear();
    return true;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return false;
    return handleApiError(err, "deleteVariable");
  }
}

// ── Variable operations ──

export async function createVariable(
  name: string,
  type: string,
  config: Record<string, unknown>,
  profileName?: string,
): Promise<GtmVariable | null> {
  if (!name)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Variable name is required",
    });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const existingNotes = config.notes ? String(config.notes) : "";
    const hasUUID = Boolean(getTagOpsId(existingNotes));
    const uuid = hasUUID ? "" : crypto.randomUUID();
    const notesValue = hasUUID
      ? existingNotes
      : `${existingNotes}${existingNotes ? "\n" : ""}TagOps-ID: ${uuid}`;
    const requestBody: Record<string, unknown> = {
      name,
      type,
      ...config,
      notes: notesValue,
    };

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.variables.create({
        parent,
        requestBody,
      }),
    );

    apiCache.clear();
    return (res.data ?? null) as GtmVariable | null;
  } catch (err) {
    return handleApiError(err, "createVariable");
  }
}

export async function updateVariable(
  variableId: string,
  requestBody: Record<string, unknown>,
  profileName?: string,
): Promise<GtmVariable | null> {
  if (!variableId)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Variable ID is required",
    });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const path = `${parent}/variables/${variableId}`;

    // Fetch latest for fingerprint
    const current = await withRetry(() =>
      gtm.accounts.containers.workspaces.variables.get({ path }),
    );
    const fingerprint = getFingerprint(current.data);

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.variables.update({
        path,
        fingerprint,
        requestBody,
      }),
    );

    apiCache.clear();
    return (res.data ?? null) as GtmVariable | null;
  } catch (err) {
    return handleApiError(err, "updateVariable");
  }
}

// ── Trigger operations ──

export async function createTrigger(
  name: string,
  type: string,
  config: Record<string, unknown>,
  profileName?: string,
): Promise<GtmTrigger | null> {
  if (!name)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Trigger name is required",
    });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const existingNotes = config.notes ? String(config.notes) : "";
    const hasUUID = Boolean(getTagOpsId(existingNotes));
    const uuid = hasUUID ? "" : crypto.randomUUID();
    const notesValue = hasUUID
      ? existingNotes
      : `${existingNotes}${existingNotes ? "\n" : ""}TagOps-ID: ${uuid}`;
    const requestBody: Record<string, unknown> = {
      name,
      type,
      ...config,
      notes: notesValue,
    };

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.triggers.create({
        parent,
        requestBody,
      }),
    );

    apiCache.clear();
    return (res.data ?? null) as GtmTrigger | null;
  } catch (err: unknown) {
    const error = err as {
      response?: { status?: number; data?: { error?: { message?: string } } };
    };
    if (
      error.response?.status === 400 &&
      error.response?.data?.error?.message?.toLowerCase().includes("duplicate name")
    ) {
      console.warn(`  [Skipped] Trigger already exists: "${name}"`);
      apiCache.delete(`triggers:${getWorkspacePath(profileName)}`);
      const existing = (await listTriggers(profileName)).find((trigger) => trigger.name === name);
      if (existing) {
        return existing;
      }
    }
    return handleApiError(err, "createTrigger");
  }
}

export async function updateTrigger(
  triggerId: string,
  requestBody: Record<string, unknown>,
  profileName?: string,
): Promise<GtmTrigger | null> {
  if (!triggerId)
    throw new TagOpsError({ code: ErrorCode.VALIDATION_FAILED, message: "Trigger ID is required" });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    const path = `${parent}/triggers/${triggerId}`;

    // Fetch latest for fingerprint
    const current = await withRetry(() =>
      gtm.accounts.containers.workspaces.triggers.get({ path }),
    );
    const fingerprint = getFingerprint(current.data);

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.triggers.update({
        path,
        fingerprint,
        requestBody,
      }),
    );

    apiCache.clear();
    return (res.data ?? null) as GtmTrigger | null;
  } catch (err) {
    return handleApiError(err, "updateTrigger");
  }
}

// ── Version operations ──

export type GtmVersionInfo = GtmVersionHeader;

export interface GtmSyncStatus {
  mergeConflict?: boolean | null;
  syncError?: boolean | null;
}

export interface GtmCreateVersionResult extends Partial<GtmVersionHeader> {
  compilerError?: boolean | null;
  syncStatus?: GtmSyncStatus;
}

type GtmVersionResource = Partial<GtmVersionHeader> & {
  tag?: unknown[];
  trigger?: unknown[];
  variable?: unknown[];
};

function getVersionPath(versionId: string, profileName?: string): string {
  return `${getContainerPath(profileName)}/versions/${versionId}`;
}

function getVersionCount(
  count: string | null | undefined,
  items: unknown[] | undefined,
): string | undefined {
  if (count != null) return count;
  if (Array.isArray(items)) return String(items.length);
  return undefined;
}

function normalizeVersionHeader(
  version: GtmVersionResource | undefined,
  fallback: Partial<Pick<GtmVersionHeader, "containerVersionId" | "name" | "path">> = {},
  profileName?: string,
): GtmVersionHeader | null {
  const containerVersionId = version?.containerVersionId ?? fallback.containerVersionId;
  if (!containerVersionId) return null;

  return {
    containerVersionId,
    name: version?.name ?? fallback.name ?? `Version ${containerVersionId}`,
    description: version?.description ?? undefined,
    numTags: getVersionCount(version?.numTags, version?.tag),
    numTriggers: getVersionCount(version?.numTriggers, version?.trigger),
    numVariables: getVersionCount(version?.numVariables, version?.variable),
    deleted: version?.deleted ?? undefined,
    fingerprint: version?.fingerprint ?? undefined,
    path: version?.path ?? fallback.path ?? getVersionPath(containerVersionId, profileName),
  };
}

function compareVersionsDescending(a: GtmVersionHeader, b: GtmVersionHeader): number {
  const aId = Number.parseInt(a.containerVersionId, 10);
  const bId = Number.parseInt(b.containerVersionId, 10);

  if (Number.isFinite(aId) && Number.isFinite(bId) && aId !== bId) {
    return bId - aId;
  }

  return b.containerVersionId.localeCompare(a.containerVersionId, undefined, { numeric: true });
}

export async function listVersions(profileName?: string): Promise<GtmVersionHeader[]> {
  try {
    const parent = getContainerPath(profileName);
    const cacheKey = `versions:${parent}`;
    const cached = getCached<GtmVersionHeader[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient(profileName);
    const versions: GtmVersionHeader[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.version_headers.list({ parent, pageToken }),
      );
      const data = (res.data ?? {}) as {
        containerVersionHeader?: GtmVersionResource[];
        nextPageToken?: string | null;
      };
      for (const header of coerceArray<GtmVersionResource>(data.containerVersionHeader)) {
        const normalized = normalizeVersionHeader(header, {}, profileName);
        if (normalized) versions.push(normalized);
      }
      pageToken = getNextPageToken(data);
    } while (pageToken);

    versions.sort(compareVersionsDescending);
    setCache(cacheKey, versions);
    return versions;
  } catch (err) {
    return handleApiError(err, "listVersions");
  }
}

export async function createVersion(
  name: string,
  description?: string,
  profileName?: string,
): Promise<GtmCreateVersionResult | null> {
  if (!name)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Version name is required",
    });

  try {
    const parent = getWorkspacePath(profileName);
    const gtm = await getGtmClient(profileName);
    // In GTM API, you create a version from a workspace path
    const requestBody: Record<string, string> = { name };
    if (description) requestBody.description = description;

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.create_version({
        path: parent,
        requestBody,
      }),
    );

    const containerVersion = normalizeVersionHeader(
      (res.data?.containerVersion ?? {}) as GtmVersionResource,
      {},
      profileName,
    );
    return {
      ...(containerVersion ?? {}),
      compilerError: res.data?.compilerError ?? undefined,
      syncStatus: (res.data?.syncStatus as GtmSyncStatus | undefined) ?? undefined,
    };
  } catch (err) {
    return handleApiError(err, "createVersion");
  }
}

export async function publishVersion(versionId: string, profileName?: string): Promise<boolean> {
  if (!versionId || versionId === "unknown") return false;

  try {
    const path = getVersionPath(versionId, profileName);
    const gtm = await getGtmClient(profileName);

    await withRetry(() => gtm.accounts.containers.versions.publish({ path }));
    apiCache.clear();
    return true;
  } catch (err) {
    return handleApiError(err, "publishVersion");
  }
}

export async function getVersionDetails(
  versionId: string,
  profileName?: string,
): Promise<GtmVersionHeader | null> {
  if (!versionId || versionId.trim().length === 0) return null;

  try {
    const path = getVersionPath(versionId, profileName);
    const gtm = await getGtmClient(profileName);
    const res = await withRetry(() => gtm.accounts.containers.versions.get({ path }));
    return normalizeVersionHeader(
      (res.data ?? {}) as GtmVersionResource,
      {
        containerVersionId: versionId,
        path,
      },
      profileName,
    );
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return null;
    return handleApiError(err, "getVersionDetails");
  }
}

export async function rollbackToVersion(
  versionId: string,
  profileName?: string,
): Promise<GtmVersionHeader | null> {
  if (!versionId || versionId.trim().length === 0 || versionId === "unknown") return null;

  try {
    const path = getVersionPath(versionId, profileName);
    const gtm = await getGtmClient(profileName);
    const res = await withRetry(() => gtm.accounts.containers.versions.publish({ path }));
    apiCache.clear();

    const publishedVersion = normalizeVersionHeader(
      (res.data?.containerVersion ?? {}) as GtmVersionResource,
      {
        containerVersionId: versionId,
        path,
      },
      profileName,
    );

    return publishedVersion ?? (await getVersionDetails(versionId, profileName));
  } catch (err) {
    return handleApiError(err, "rollbackToVersion");
  }
}

export async function getLatestPublishedVersion(
  profileName?: string,
): Promise<GtmVersionHeader | null> {
  try {
    const parent = getContainerPath(profileName);
    const gtm = await getGtmClient(profileName);
    const res = await withRetry(() => gtm.accounts.containers.versions.live({ parent }));
    return normalizeVersionHeader((res.data ?? {}) as GtmVersionResource, {}, profileName);
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return null;
    return handleApiError(err, "getLatestPublishedVersion");
  }
}

// ── Consent helper ──

function normalizeConsentTypes(consentType: GtmConsentSignalInput): GtmConsentSignalValue[] {
  const values = (Array.isArray(consentType) ? consentType : [consentType])
    .flatMap((entry) => entry.split(","))
    .map((entry) => entry.trim())
    .filter(Boolean);

  return [...new Set(values)];
}

export function buildConsentConfig(consentType: GtmConsentSignalInput): GtmConsentSettings {
  const consentTypes = normalizeConsentTypes(consentType);
  return {
    consentStatus: "needed",
    consentType: {
      type: "list",
      list: consentTypes.map((value) => ({ type: "template", value })),
    },
  };
}

// ── HTML tag config builder ──

export function buildHtmlTagConfig(
  html: string,
  consentType?: GtmConsentSignalInput,
): Record<string, unknown> {
  const config: Record<string, unknown> = {
    parameter: [
      { type: "template", key: "html", value: html } as GtmParameter,
      { type: "boolean", key: "supportDocumentWrite", value: "false" } as GtmParameter,
    ],
  };
  if (consentType) {
    config.consentSettings = buildConsentConfig(consentType);
  }
  return config;
}
