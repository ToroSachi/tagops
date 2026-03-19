/**
 * GTM API Wrapper — direct interface to @googleapis/tagmanager
 *
 * Replaces the legacy Python CLI wrapper. Now makes direct network calls
 * using App Default Credentials or Local OAuth flow.
 * Every script and the MCP server imports from here — single source of truth.
 */

import { tagmanager } from "@googleapis/tagmanager";
import crypto from "node:crypto";
import { getAuthClient } from "./auth.js";
import { loadConfig, ConfigError } from "./config.js";
import type {
  GtmTag,
  GtmTrigger,
  GtmVariable,
  GtmConsentSettings,
  GtmParameter,
} from "../types/gtm.js";
import { TagOpsError, ErrorCode } from "./errors.js";

// ── API Factory & Helpers ──

class Semaphore {
  private queue: Array<() => void> = [];
  constructor(
    private maxConcurrent: number,
    private current = 0,
  ) {}
  async acquire(): Promise<void> {
    if (this.current < this.maxConcurrent) {
      this.current++;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }
  release(): void {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next?.();
    } else {
      this.current--;
    }
  }
}
const apiSemaphore = new Semaphore(5);

const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(operation: () => Promise<T>, maxRetries = 3): Promise<T> {
  await apiSemaphore.acquire();
  try {
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
  } finally {
    apiSemaphore.release();
  }
}

export async function getGtmClient() {
  const auth = await getAuthClient();
  // Type assertion at library boundary — our auth types are runtime-compatible with googleapis
  return tagmanager({
    version: "v2",
    auth: auth as unknown as Parameters<typeof tagmanager>[0]["auth"],
  });
}

export function getWorkspacePath(): string {
  const config = loadConfig();
  return `accounts/${config.accountId}/containers/${config.containerId}/workspaces/${config.workspaceId}`;
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

  const details = error.response?.data?.error?.message || error.message || "Unknown error";
  throw new TagOpsError({
    code: ErrorCode.INTERNAL_ERROR,
    message: `GTM API failed during ${operation}: ${details}`,
  });
}

export async function listWorkspaces(): Promise<Array<{ workspaceId: string; name: string }>> {
  try {
    const config = loadConfig();
    const parent = `accounts/${config.accountId}/containers/${config.containerId}`;
    const gtm = await getGtmClient();
    const res = await withRetry(() => gtm.accounts.containers.workspaces.list({ parent }));
    const workspaces = res.data.workspace || [];
    return workspaces.map((w: any) => ({
      workspaceId: w.workspaceId as string,
      name: w.name as string,
    }));
  } catch (err) {
    return handleApiError(err, "listWorkspaces");
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

export async function listTags(): Promise<GtmTag[]> {
  try {
    const parent = getWorkspacePath();
    const cacheKey = `tags:${parent}`;
    const cached = getCached<GtmTag[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient();
    const allTags: GtmTag[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.tags.list({
          parent,
          pageToken,
        }),
      );
      const tags = (res.data.tag as GtmTag[]) || [];
      allTags.push(...tags);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    setCache(cacheKey, allTags);
    return allTags;
  } catch (err) {
    return handleApiError(err, "listTags");
  }
}

export async function getTag(tagId: string): Promise<GtmTag | null> {
  if (!tagId || tagId.trim().length === 0) return null;
  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.tags.get({ path: `${parent}/tags/${tagId}` }),
    );
    return res.data as GtmTag;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return null;
    return handleApiError(err, "getTag");
  }
}

export async function listTriggers(): Promise<GtmTrigger[]> {
  try {
    const parent = getWorkspacePath();
    const cacheKey = `triggers:${parent}`;
    const cached = getCached<GtmTrigger[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient();
    const allTriggers: GtmTrigger[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.triggers.list({
          parent,
          pageToken,
        }),
      );
      const triggers = (res.data.trigger as GtmTrigger[]) || [];
      allTriggers.push(...triggers);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    setCache(cacheKey, allTriggers);
    return allTriggers;
  } catch (err) {
    return handleApiError(err, "listTriggers");
  }
}

export async function getTrigger(triggerId: string): Promise<GtmTrigger | null> {
  if (!triggerId || triggerId.trim().length === 0) return null;
  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.triggers.get({ path: `${parent}/triggers/${triggerId}` }),
    );
    return res.data as GtmTrigger;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return null;
    return handleApiError(err, "getTrigger");
  }
}

export async function listVariables(): Promise<GtmVariable[]> {
  try {
    const parent = getWorkspacePath();
    const cacheKey = `variables:${parent}`;
    const cached = getCached<GtmVariable[]>(cacheKey);
    if (cached) return cached;

    const gtm = await getGtmClient();
    const allVariables: GtmVariable[] = [];
    let pageToken: string | undefined;

    do {
      const res = await withRetry(() =>
        gtm.accounts.containers.workspaces.variables.list({
          parent,
          pageToken,
        }),
      );
      const variables = (res.data.variable as GtmVariable[]) || [];
      allVariables.push(...variables);
      pageToken = res.data.nextPageToken ?? undefined;
    } while (pageToken);

    setCache(cacheKey, allVariables);
    return allVariables;
  } catch (err) {
    return handleApiError(err, "listVariables");
  }
}

// ── Tag operations ──

export interface CreateTagInput {
  name: string;
  type: string;
  firingTriggerId?: string | string[];
  config: Record<string, unknown>;
}

export async function createTag(input: CreateTagInput): Promise<string> {
  if (!input.name)
    throw new TagOpsError({ code: ErrorCode.VALIDATION_FAILED, message: "Tag name is required" });

  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    const existingNotes = input.config.notes ? String(input.config.notes) : "";
    // Only inject UUID if one isn't already present (prevents duplicates on re-sync)
    const hasUUID = existingNotes.includes("TagOps-ID:");
    const uuid = hasUUID ? "" : crypto.randomUUID();
    const notesValue = hasUUID
      ? existingNotes
      : `${existingNotes}${existingNotes ? "\n" : ""}TagOps-ID: ${uuid}`;
    const requestBody: Record<string, unknown> = {
      name: input.name,
      type: input.type,
      ...input.config,
      notes: notesValue,
    };

    if (input.firingTriggerId) {
      if (Array.isArray(input.firingTriggerId)) {
        requestBody.firingTriggerId = input.firingTriggerId;
      } else if (typeof input.firingTriggerId === "string") {
        requestBody.firingTriggerId = input.firingTriggerId
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
      }
    }

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.tags.create({
        parent,
        requestBody,
      }),
    );

    apiCache.clear();
    return JSON.stringify(res.data, null, 2);
  } catch (err: unknown) {
    const error = err as {
      response?: { status?: number; data?: { error?: { message?: string } } };
    };
    if (
      error.response?.status === 400 &&
      error.response?.data?.error?.message?.toLowerCase().includes("duplicate name")
    ) {
      console.warn(`  [Skipped] Tag already exists: "${input.name}"`);
      return JSON.stringify({ tagId: "skipped", name: input.name });
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

export async function updateTag(input: UpdateTagInput): Promise<string> {
  if (!input.tagId)
    throw new TagOpsError({ code: ErrorCode.VALIDATION_FAILED, message: "Tag ID is required" });
  if (!input.fingerprint)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Fingerprint is required for updates",
    });

  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();

    const requestBody: Record<string, unknown> = {
      name: input.name,
      fingerprint: input.fingerprint,
      ...input.config,
    };

    if (input.firingTriggerId) {
      if (Array.isArray(input.firingTriggerId)) {
        requestBody.firingTriggerId = input.firingTriggerId;
      } else if (typeof input.firingTriggerId === "string") {
        requestBody.firingTriggerId = input.firingTriggerId
          .split(",")
          .map((id) => id.trim())
          .filter(Boolean);
      }
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

export async function deleteTag(tagId: string): Promise<boolean> {
  if (!tagId) return false;
  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    await gtm.accounts.containers.workspaces.tags.delete({ path: `${parent}/tags/${tagId}` });
    apiCache.clear();
    return true;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return false;
    return handleApiError(err, "deleteTag");
  }
}

export async function deleteTrigger(triggerId: string): Promise<boolean> {
  if (!triggerId) return false;
  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    await gtm.accounts.containers.workspaces.triggers.delete({
      path: `${parent}/triggers/${triggerId}`,
    });
    apiCache.clear();
    return true;
  } catch (err: unknown) {
    const error = err as { response?: { status?: number } };
    if (error.response?.status === 404) return false;
    return handleApiError(err, "deleteTrigger");
  }
}

export async function deleteVariable(variableId: string): Promise<boolean> {
  if (!variableId) return false;
  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    await gtm.accounts.containers.workspaces.variables.delete({
      path: `${parent}/variables/${variableId}`,
    });
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
): Promise<GtmVariable | null> {
  if (!name)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Variable name is required",
    });

  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    const existingNotes = config.notes ? String(config.notes) : "";
    const hasUUID = existingNotes.includes("TagOps-ID:");
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
    return res.data as GtmVariable;
  } catch (err) {
    return handleApiError(err, "createVariable");
  }
}

export async function updateVariable(
  variableId: string,
  requestBody: Record<string, unknown>,
): Promise<GtmVariable | null> {
  if (!variableId)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Variable ID is required",
    });

  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    const path = `${parent}/variables/${variableId}`;

    // Fetch latest for fingerprint
    const current = await withRetry(() =>
      gtm.accounts.containers.workspaces.variables.get({ path }),
    );
    const fingerprint = current.data.fingerprint ?? undefined;

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.variables.update({
        path,
        fingerprint,
        requestBody,
      }),
    );

    apiCache.clear();
    return res.data as GtmVariable;
  } catch (err) {
    return handleApiError(err, "updateVariable");
  }
}

// ── Trigger operations ──

export async function createTrigger(
  name: string,
  type: string,
  config: Record<string, unknown>,
): Promise<GtmTrigger | null> {
  if (!name)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Trigger name is required",
    });

  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    const existingNotes = config.notes ? String(config.notes) : "";
    const hasUUID = existingNotes.includes("TagOps-ID:");
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
    return res.data as GtmTrigger;
  } catch (err: unknown) {
    const error = err as {
      response?: { status?: number; data?: { error?: { message?: string } } };
    };
    if (
      error.response?.status === 400 &&
      error.response?.data?.error?.message?.toLowerCase().includes("duplicate name")
    ) {
      console.warn(`  [Skipped] Trigger already exists: "${name}"`);
      // Lookup the real trigger ID so dependent tags can still be created
      const reqPath = getWorkspacePath();
      const gtm = await getGtmClient();
      const listRes = await withRetry(() =>
        gtm.accounts.containers.workspaces.triggers.list({ parent: reqPath }),
      );
      const existing = listRes.data.trigger?.find((t: any) => t.name === name);
      if (existing) {
        return existing as GtmTrigger;
      }
    }
    return handleApiError(err, "createTrigger");
  }
}

export async function updateTrigger(
  triggerId: string,
  requestBody: Record<string, unknown>,
): Promise<GtmTrigger | null> {
  if (!triggerId)
    throw new TagOpsError({ code: ErrorCode.VALIDATION_FAILED, message: "Trigger ID is required" });

  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    const path = `${parent}/triggers/${triggerId}`;

    // Fetch latest for fingerprint
    const current = await withRetry(() =>
      gtm.accounts.containers.workspaces.triggers.get({ path }),
    );
    const fingerprint = current.data.fingerprint ?? undefined;

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.triggers.update({
        path,
        fingerprint,
        requestBody,
      }),
    );

    apiCache.clear();
    return res.data as GtmTrigger;
  } catch (err) {
    return handleApiError(err, "updateTrigger");
  }
}

// ── Version operations ──

export interface GtmVersionInfo {
  containerVersionId: string;
  name: string;
  description?: string;
  fingerprint?: string;
}

export async function listVersions(): Promise<GtmVersionInfo[]> {
  try {
    const config = loadConfig();
    const parent = `accounts/${config.accountId}/containers/${config.containerId}`;
    const gtm = await getGtmClient();
    const res = await withRetry(() => gtm.accounts.containers.version_headers.list({ parent }));
    const data = res.data as { containerVersionHeader?: GtmVersionInfo[] };
    return data.containerVersionHeader ?? [];
  } catch (err) {
    return handleApiError(err, "listVersions");
  }
}

export async function createVersion(
  name: string,
  description?: string,
): Promise<GtmVersionInfo | null> {
  if (!name)
    throw new TagOpsError({
      code: ErrorCode.VALIDATION_FAILED,
      message: "Version name is required",
    });

  try {
    const parent = getWorkspacePath();
    const gtm = await getGtmClient();
    // In GTM API, you create a version from a workspace path
    const requestBody: Record<string, string> = { name };
    if (description) requestBody.description = description;

    const res = await withRetry(() =>
      gtm.accounts.containers.workspaces.create_version({
        path: parent,
        requestBody,
      }),
    );

    return res.data.containerVersion as GtmVersionInfo;
  } catch (err) {
    return handleApiError(err, "createVersion");
  }
}

export async function publishVersion(versionId: string): Promise<boolean> {
  if (!versionId || versionId === "unknown") return false;

  try {
    const config = loadConfig();
    const path = `accounts/${config.accountId}/containers/${config.containerId}/versions/${versionId}`;
    const gtm = await getGtmClient();

    await gtm.accounts.containers.versions.publish({ path });
    return true;
  } catch (err) {
    return handleApiError(err, "publishVersion");
  }
}

// ── Consent helper ──

export function buildConsentConfig(consentType: string): GtmConsentSettings {
  return {
    consentStatus: "needed",
    consentType: {
      type: "list",
      list: [{ type: "template", value: consentType }],
    },
  };
}

// ── HTML tag config builder ──

export function buildHtmlTagConfig(html: string, consentType?: string): Record<string, unknown> {
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
