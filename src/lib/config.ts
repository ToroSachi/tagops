/**
 * Configuration management — reads/writes `.gtmrc.json`.
 *
 * Makes the toolkit container-agnostic. All commands read from this config
 * instead of hardcoded values. Falls back to architecture.ts defaults if
 * no config file exists.
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const CONFIG_FILENAME = ".gtmrc.json";

// ── Zod schema for config validation ──

const GtmProfileSchema = z.object({
  name: z.string().min(1, "profile name is required"),
  accountId: z.string().min(1, "accountId is required"),
  containerId: z.string().min(1, "containerId is required"),
  workspaceId: z.string().min(1, "workspaceId is required"),
  ga4MeasurementId: z.string().optional(),
  metaPixelId: z.string().optional(),
});

export type GtmProfile = z.infer<typeof GtmProfileSchema>;

const GtmConfigSchema = z.object({
  accountId: z.string().min(1, "accountId is required"),
  containerId: z.string().min(1, "containerId is required"),
  workspaceId: z.string().min(1, "workspaceId is required"),
  ga4MeasurementId: z.string().optional(),
  metaPixelId: z.string().optional(),
  integrations: z.array(z.string()).optional(),
  profiles: z.array(GtmProfileSchema).optional(),
  customTriggers: z
    .record(
      z.object({
        id: z.string(),
        name: z.string(),
        event: z.string(),
      }),
    )
    .optional(),
  customVariables: z.record(z.string()).optional(),
});

export type GtmConfig = z.infer<typeof GtmConfigSchema>;

export class ConfigError extends Error {
  constructor(
    message: string,
    public readonly configPath: string,
    public readonly validationErrors?: string[],
  ) {
    super(message);
    this.name = "ConfigError";
  }
}

/**
 * Treat "default" as the base config, not a named profile entry.
 */
export function normalizeProfileName(profileName?: string): string | undefined {
  if (!profileName || profileName === "default") {
    return undefined;
  }
  return profileName;
}

/**
 * Find the nearest `.gtmrc.json` by walking up from cwd.
 */
export function findConfigPath(startDir?: string): string | null {
  let dir = resolve(startDir ?? process.cwd());
  const root = resolve("/");

  while (dir !== root) {
    const candidate = resolve(dir, CONFIG_FILENAME);
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  return null;
}

/**
 * Load config from `.gtmrc.json`, or return defaults.
 * Validates the config structure with Zod.
 * If a profile name is provided, merges the profile's values into the base config.
 */
export function loadConfig(profileName?: string): GtmConfig {
  const configPath = findConfigPath();
  if (configPath) {
    let raw: string;
    try {
      raw = readFileSync(configPath, "utf-8");
    } catch (err) {
      throw new ConfigError(`Cannot read config file: ${(err as Error).message}`, configPath);
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new ConfigError(`Invalid JSON in config file: ${configPath}`, configPath);
    }

    const result = GtmConfigSchema.safeParse(parsed);
    if (!result.success) {
      const errors = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
      throw new ConfigError(
        `Invalid config in ${configPath}:\n${errors.join("\n")}`,
        configPath,
        errors,
      );
    }

    let config = result.data;

    // If --profile was specified, overlay the profile values
    const requestedProfileName = normalizeProfileName(profileName);
    if (requestedProfileName) {
      const profile = config.profiles?.find((p) => p.name === requestedProfileName);
      if (!profile) {
        const available = config.profiles?.map((p) => p.name).join(", ") ?? "(none)";
        throw new ConfigError(
          `Profile "${requestedProfileName}" not found. Available: ${available}`,
          configPath,
        );
      }
      config = {
        ...config,
        accountId: profile.accountId,
        containerId: profile.containerId,
        workspaceId: profile.workspaceId,
        ga4MeasurementId: profile.ga4MeasurementId ?? config.ga4MeasurementId,
        metaPixelId: profile.metaPixelId ?? config.metaPixelId,
      };
    }

    return config;
  }

  // No config file found — tell the user how to create one
  throw new Error("No .gtmrc.json found. Run: tagops init --account-id <ID> --container-id <ID>");
}

/**
 * Return the base config plus any named profiles as full dashboard-ready objects.
 */
export function listProfileConfigs(): Array<{
  name: string;
  accountId: string;
  containerId: string;
  workspaceId: string;
  ga4MeasurementId?: string;
  metaPixelId?: string;
}> {
  const config = loadConfig();

  return [
    {
      name: "default",
      accountId: config.accountId,
      containerId: config.containerId,
      workspaceId: config.workspaceId,
      ga4MeasurementId: config.ga4MeasurementId,
      metaPixelId: config.metaPixelId,
    },
    ...(config.profiles ?? []).map((profile) => ({
      name: profile.name,
      accountId: profile.accountId,
      containerId: profile.containerId,
      workspaceId: profile.workspaceId,
      ga4MeasurementId: profile.ga4MeasurementId,
      metaPixelId: profile.metaPixelId,
    })),
  ];
}

/**
 * List all profile names in the current config.
 */
export function listProfiles(): string[] {
  const config = loadConfig();
  return config.profiles?.map((p) => p.name) ?? [];
}

/**
 * Write config to `.gtmrc.json` in the given directory.
 * Validates before writing.
 */
export function writeConfig(config: GtmConfig, dir?: string): string {
  // Validate before writing
  const result = GtmConfigSchema.safeParse(config);
  if (!result.success) {
    const errors = result.error.issues.map((i) => `  ${i.path.join(".")}: ${i.message}`);
    throw new Error(`Invalid config:\n${errors.join("\n")}`);
  }

  const targetDir = dir ?? process.cwd();
  const path = resolve(targetDir, CONFIG_FILENAME);
  writeFileSync(path, JSON.stringify(result.data, null, 2) + "\n");
  return path;
}

/**
 * Check if a config file exists.
 */
export function hasConfig(): boolean {
  return findConfigPath() !== null;
}

/**
 * Get the config file path (or null).
 */
export function getConfigPath(): string | null {
  return findConfigPath();
}
