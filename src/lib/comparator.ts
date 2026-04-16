import { stripTagOpsId } from "./identity.js";

const VOLATILE_COMPARISON_KEYS = new Set([
  "fingerprint",
  "path",
  "accountId",
  "containerId",
  "workspaceId",
]);

export type NormalizedComparisonValue =
  | string
  | number
  | boolean
  | NormalizedComparisonValue[]
  | { [key: string]: NormalizedComparisonValue };

function stableComparisonString(value: NormalizedComparisonValue | undefined): string {
  return JSON.stringify(value ?? null);
}

export function normalizeForComparison(resource: unknown): NormalizedComparisonValue | undefined {
  if (resource === undefined || resource === null) return undefined;

  if (
    typeof resource === "string" ||
    typeof resource === "number" ||
    typeof resource === "boolean"
  ) {
    return resource;
  }

  if (Array.isArray(resource)) {
    const normalized = resource
      .map((item) => normalizeForComparison(item))
      .filter((item): item is NormalizedComparisonValue => item !== undefined);

    if (normalized.length === 0) return undefined;

    return normalized
      .slice()
      .sort((a, b) => stableComparisonString(a).localeCompare(stableComparisonString(b)));
  }

  if (typeof resource === "object") {
    const entries = Object.entries(resource as Record<string, unknown>)
      .filter(([key]) => !VOLATILE_COMPARISON_KEYS.has(key))
      .map(([key, value]) => {
        const normalizedValue =
          key === "notes"
            ? normalizeForComparison(stripTagOpsId(typeof value === "string" ? value : undefined))
            : normalizeForComparison(value);

        return [key, normalizedValue] as const;
      })
      .filter(([, value]) => value !== undefined)
      .sort(([a], [b]) => a.localeCompare(b));

    if (entries.length === 0) return undefined;

    return Object.fromEntries(entries) as {
      [key: string]: NormalizedComparisonValue;
    };
  }

  return undefined;
}

export function areResourcesEqual(a: unknown, b: unknown): boolean {
  return (
    stableComparisonString(normalizeForComparison(a)) ===
    stableComparisonString(normalizeForComparison(b))
  );
}
