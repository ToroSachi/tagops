const TAGOPS_ID_LINE = /(?:^|\n)\s*TagOps-ID:\s*([^\n\r]+)\s*(?=\n|$)/i;
const TAGOPS_ID_LINE_GLOBAL = /(?:^|\n)\s*TagOps-ID:\s*[^\n\r]+\s*(?=\n|$)/gi;

const DEFAULT_VOLATILE_FIELDS = ["accountId", "containerId", "fingerprint", "path", "workspaceId"];

export interface ResourceMatch<T> {
  source: T;
  target?: T;
}

function getStringValue(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function groupBy<T>(items: T[], getKey: (item: T) => string | undefined): Map<string, T[]> {
  const groups = new Map<string, T[]>();

  for (const item of items) {
    const key = getKey(item);
    if (!key) continue;
    const group = groups.get(key);
    if (group) {
      group.push(item);
    } else {
      groups.set(key, [item]);
    }
  }

  return groups;
}

function findFirstUnmatched<T>(items: T[] | undefined, matched: Set<T>): T | undefined {
  return items?.find((item) => !matched.has(item));
}

function findUniqueUnmatched<T>(items: T[] | undefined, matched: Set<T>): T | undefined {
  const unmatched = (items ?? []).filter((item) => !matched.has(item));
  return unmatched.length === 1 ? unmatched[0] : undefined;
}

export function getTagOpsId(notes?: string): string | undefined {
  const match = notes?.match(TAGOPS_ID_LINE);
  return getStringValue(match?.[1]);
}

export function stripTagOpsId(notes?: string): string | undefined {
  if (!notes) return undefined;

  const cleaned = notes
    .replace(TAGOPS_ID_LINE_GLOBAL, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return cleaned.length > 0 ? cleaned : undefined;
}

export function matchResources<T extends { name: string }>(
  sourceList: T[],
  targetList: T[],
  idKey: keyof T,
  getIdentity: (item: T) => string | undefined,
): ResourceMatch<T>[] {
  const matches: ResourceMatch<T>[] = [];
  const matchedTargets = new Set<T>();
  const targetsByIdentity = groupBy(targetList, getIdentity);
  const targetsById = groupBy(targetList, (item) => getStringValue(item[idKey]));
  const targetsByName = groupBy(targetList, (item) => getStringValue(item.name));

  for (const source of sourceList) {
    const sourceIdentity = getIdentity(source);
    const sourceId = getStringValue(source[idKey]);
    let target = findFirstUnmatched(targetsByIdentity.get(sourceIdentity ?? ""), matchedTargets);

    if (!target && sourceId) {
      target = findFirstUnmatched(targetsById.get(sourceId), matchedTargets);
    }

    if (!target) {
      target = findUniqueUnmatched(targetsByName.get(source.name), matchedTargets);
    }

    if (target) {
      matchedTargets.add(target);
    }

    matches.push({ source, target });
  }

  return matches;
}

export function stripVolatileFields<T extends object>(
  resource: T,
  extraKeys: Iterable<string> = [],
): Record<string, unknown> {
  const clone = { ...(resource as Record<string, unknown>) };

  for (const key of DEFAULT_VOLATILE_FIELDS) {
    delete clone[key];
  }

  for (const key of extraKeys) {
    delete clone[key];
  }

  return clone;
}
