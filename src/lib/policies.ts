import chalk from "chalk";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  BUILTIN_TRIGGER_IDS,
  TRIGGER_PREFIX_PATTERN,
  isAdVendor,
  isAnalyticsVendor,
  isLightweightPixel,
  matchesCustomEventTrigger,
} from "./architecture.js";
import type { GtmConsentSignalValue, GtmTag, GtmTrigger, GtmVariable } from "../types/gtm.js";

export type PolicySeverity = "error" | "warning" | "info";
export type PolicyCategory =
  | "consent"
  | "firing"
  | "naming"
  | "security"
  | "performance"
  | "vendor";
export type PolicyResourceType = "tag" | "trigger" | "workspace";

export interface PolicyViolation {
  policyId: string;
  policyName: string;
  severity: PolicySeverity;
  category: PolicyCategory;
  resourceType: PolicyResourceType;
  resourceId: string;
  resourceName: string;
  message: string;
}

export interface Policy {
  id: string;
  name: string;
  description: string;
  severity: PolicySeverity;
  category: PolicyCategory;
  check(tag: GtmTag, triggers: GtmTrigger[], variables: GtmVariable[]): PolicyViolation[];
  checkWorkspace?(
    tags: GtmTag[],
    triggers: GtmTrigger[],
    variables: GtmVariable[],
  ): PolicyViolation[];
}

export interface PolicyReport {
  timestamp: string;
  enabledPolicies: string[];
  violations: PolicyViolation[];
  passed: boolean;
  summary: {
    errors: number;
    warnings: number;
    info: number;
    total: number;
  };
  resources: {
    tags: number;
    triggers: number;
    variables: number;
  };
}

type StringList = string | string[];

export interface NamingPolicyConfig {
  tagPrefix?: StringList;
  tagPrefixes?: string[];
  triggerPrefix?: StringList;
  triggerPrefixes?: string[];
  tagPattern?: string;
  triggerPattern?: string;
}

export interface CustomPolicyDefinition {
  id: string;
  name: string;
  description: string;
  severity?: PolicySeverity;
  category: PolicyCategory;
  target: "tag" | "trigger";
  match?: {
    nameIncludes?: StringList;
    namePattern?: string;
    typeIn?: StringList;
    htmlIncludes?: StringList;
    vendorIn?: StringList;
    firingTriggerTypes?: StringList;
  };
  require?: {
    consentSignals?: StringList;
    namePrefixes?: StringList;
    htmlIncludes?: StringList;
    eventId?: boolean;
    noDocumentWrite?: boolean;
    firingOptionNot?: StringList;
    used?: boolean;
  };
}

export interface PolicyFileConfig {
  enabledPolicies?: string[];
  disabledPolicies?: string[];
  naming?: NamingPolicyConfig;
  vendorConsentMatrix?: Record<string, GtmConsentSignalValue[]>;
  customPolicies?: CustomPolicyDefinition[];
}

interface NormalizedNamingConfig {
  tagPrefixes?: string[];
  triggerPrefixes?: string[];
  tagPattern?: RegExp;
  triggerPattern?: RegExp;
}

interface NormalizedCustomPolicy {
  id: string;
  name: string;
  description: string;
  severity: PolicySeverity;
  category: PolicyCategory;
  target: "tag" | "trigger";
  match: {
    nameIncludes?: string[];
    namePattern?: RegExp;
    typeIn?: string[];
    htmlIncludes?: string[];
    vendorIn?: string[];
    firingTriggerTypes?: string[];
  };
  require: {
    consentSignals?: string[];
    namePrefixes?: string[];
    htmlIncludes?: string[];
    eventId?: boolean;
    noDocumentWrite?: boolean;
    firingOptionNot?: string[];
    used?: boolean;
  };
}

const POLICY_CONFIG_FILENAME = ".tagops-policies.json";

const ADVERTISING_TAG_TYPES = new Set(["awct", "sp", "flc", "fls", "gclidw", "sar"]);
const ANALYTICS_TAG_TYPES = new Set(["gaawc", "gaawe", "googtag", "ua"]);
const GOOGLE_ADS_MEASUREMENT_TAG_TYPES = new Set(["awct", "flc", "fls"]);
const GOOGLE_ADS_MEASUREMENT_PATTERNS = [
  /\bconversion\b/i,
  /conversion tracking/i,
  /conversion label/i,
  /google_conversion/i,
  /send_to/i,
  /enhanced conversion/i,
  /floodlight/i,
];
const SERVER_CONTAINER_PATTERNS = [
  /server[- ]side/i,
  /server container/i,
  /tagging server/i,
  /transport_url/i,
  /server_container_url/i,
  /taggingServerUrl/i,
  /\bsgtm\b/i,
];
const META_CAPI_PATTERNS = [
  /\bmeta capi\b/i,
  /\bfacebook capi\b/i,
  /\bcapi\b/i,
  /conversions api/i,
  /graph\.facebook\.com/i,
  /meta server/i,
  /facebook server/i,
];
const META_EVENT_PATTERNS = [
  /fbq\s*\(\s*['"]track(?:Custom)?['"]/i,
  /\b(page[\s_-]?view|purchase|lead|add[\s_-]?to[\s_-]?cart|view[\s_-]?content|initiate[\s_-]?checkout|search|subscribe|contact|complete[\s_-]?registration)\b/i,
];

const DEFAULT_TAG_PREFIX_PATTERN = /^[A-Za-z0-9][A-Za-z0-9 ]*\s[-–]\s/;
const DEFAULT_TRIGGER_PREFIX_PATTERN = TRIGGER_PREFIX_PATTERN;
const VALID_POLICY_SEVERITIES = new Set<PolicySeverity>(["error", "warning", "info"]);
const VALID_POLICY_CATEGORIES = new Set<PolicyCategory>([
  "consent",
  "firing",
  "naming",
  "security",
  "performance",
  "vendor",
]);
const VALID_CUSTOM_POLICY_TARGETS = new Set<"tag" | "trigger">(["tag", "trigger"]);

const SEVERITY_ORDER: Record<PolicySeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

const VENDOR_ALIAS_PATTERNS: Record<string, RegExp[]> = {
  meta: [/\bmeta\b/i, /facebook/i, /\bfbq\b/i, /fbevents/i],
  ga4: [/\bga4\b/i, /google analytics 4/i, /\bgtag\b/i],
  "google analytics": [/google-analytics/i, /\bga\s*\(/i, /\bga4\b/i, /\bgtag\b/i],
  "google ads": [/google ads/i, /doubleclick/i, /\badwords\b/i, /conversion linker/i],
  tiktok: [/\btiktok\b/i, /\bttq\b/i],
  pinterest: [/\bpinterest\b/i, /\bpintrk\b/i],
  reddit: [/\breddit\b/i],
  linkedin: [/\blinkedin\b/i],
  snapchat: [/\bsnapchat\b/i, /\bsnaptr\b/i],
  taboola: [/\btaboola\b/i],
  outbrain: [/\boutbrain\b/i],
  criteo: [/\bcriteo\b/i],
  artsai: [/\bartsai\b/i, /\barttrk\b/i],
  magellan: [/\bmagellan\b/i, /\bmgln\.ai\b/i],
};

export const DEFAULT_VENDOR_CONSENT_MATRIX: Record<string, GtmConsentSignalValue[]> = {
  Meta: ["ad_storage"],
  GA4: ["analytics_storage"],
  "Google Analytics": ["analytics_storage"],
  "Google Ads": ["ad_storage", "ad_user_data"],
  TikTok: ["ad_storage"],
  Pinterest: ["ad_storage"],
  Reddit: ["ad_storage"],
  LinkedIn: ["ad_storage"],
  Snapchat: ["ad_storage"],
  Taboola: ["ad_storage"],
  Outbrain: ["ad_storage"],
  Criteo: ["ad_storage"],
  Artsai: ["ad_storage"],
  Magellan: ["ad_storage"],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeStringList(value: unknown, fieldName: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : undefined;
  }

  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${fieldName}: expected a string or string[]`);
  }

  const normalized = value
    .filter((item) => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);

  if (normalized.length !== value.length) {
    throw new Error(`Invalid ${fieldName}: every entry must be a string`);
  }

  return normalized.length > 0 ? normalized : undefined;
}

function parseOptionalRegex(value: unknown, fieldName: string): RegExp | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "string") {
    throw new Error(`Invalid ${fieldName}: expected a regex string`);
  }

  try {
    return new RegExp(value);
  } catch (err) {
    throw new Error(`Invalid ${fieldName}: ${(err as Error).message}`);
  }
}

function normalizeSeverity(value: unknown, fieldName: string): PolicySeverity | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || !VALID_POLICY_SEVERITIES.has(value as PolicySeverity)) {
    throw new Error(`Invalid ${fieldName}: expected error, warning, or info`);
  }
  return value as PolicySeverity;
}

function normalizeCategory(value: unknown, fieldName: string): PolicyCategory {
  if (typeof value !== "string" || !VALID_POLICY_CATEGORIES.has(value as PolicyCategory)) {
    throw new Error(
      `Invalid ${fieldName}: expected consent, firing, naming, security, performance, or vendor`,
    );
  }
  return value as PolicyCategory;
}

function normalizeTarget(value: unknown, fieldName: string): "tag" | "trigger" {
  if (typeof value !== "string" || !VALID_CUSTOM_POLICY_TARGETS.has(value as "tag" | "trigger")) {
    throw new Error(`Invalid ${fieldName}: expected tag or trigger`);
  }
  return value as "tag" | "trigger";
}

function normalizeOptionalBoolean(value: unknown, fieldName: string): boolean | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${fieldName}: expected a boolean`);
  }
  return value;
}

function normalizeNamingConfig(config?: NamingPolicyConfig): NormalizedNamingConfig {
  return {
    tagPrefixes: normalizeStringList(
      config?.tagPrefixes ?? config?.tagPrefix,
      "naming.tagPrefixes",
    ),
    triggerPrefixes: normalizeStringList(
      config?.triggerPrefixes ?? config?.triggerPrefix,
      "naming.triggerPrefixes",
    ),
    tagPattern: parseOptionalRegex(config?.tagPattern, "naming.tagPattern"),
    triggerPattern: parseOptionalRegex(config?.triggerPattern, "naming.triggerPattern"),
  };
}

function normalizeVendorConsentMatrix(
  vendorConsentMatrix?: Record<string, GtmConsentSignalValue[]>,
): Record<string, GtmConsentSignalValue[]> {
  if (!vendorConsentMatrix) {
    return { ...DEFAULT_VENDOR_CONSENT_MATRIX };
  }

  if (!isRecord(vendorConsentMatrix)) {
    throw new Error("Invalid vendorConsentMatrix: expected an object of vendor -> string[]");
  }

  const merged = { ...DEFAULT_VENDOR_CONSENT_MATRIX };

  for (const [vendor, signals] of Object.entries(vendorConsentMatrix)) {
    if (!Array.isArray(signals) || signals.some((signal) => typeof signal !== "string")) {
      throw new Error(`Invalid vendorConsentMatrix.${vendor}: expected string[]`);
    }
    merged[vendor] = signals.map((signal) => signal.trim()).filter(Boolean);
  }

  return merged;
}

function getHtml(tag: GtmTag): string {
  return tag.parameter?.find((parameter) => parameter.key === "html")?.value ?? "";
}

export function getTagSearchText(tag: GtmTag): string {
  return `${tag.name} ${getHtml(tag)} ${JSON.stringify(tag.parameter ?? [])}`;
}

export function getConfiguredConsentSignals(tag: GtmTag): GtmConsentSignalValue[] {
  if (tag.consentSettings?.consentStatus !== "needed") {
    return [];
  }
  return tag.consentSettings.consentType?.list?.map((entry) => entry.value) ?? [];
}

export function getMissingConsentSignals(
  tag: GtmTag,
  requiredSignals: GtmConsentSignalValue[],
): GtmConsentSignalValue[] {
  const configuredSignals = new Set(getConfiguredConsentSignals(tag));
  return requiredSignals.filter((signal) => !configuredSignals.has(signal));
}

function hasDocumentWriteEnabled(tag: GtmTag): boolean {
  return (
    tag.parameter?.some(
      (parameter) => parameter.key === "supportDocumentWrite" && parameter.value === "true",
    ) ?? false
  );
}

function hasEventId(tag: GtmTag): boolean {
  const parameterText = JSON.stringify(tag.parameter ?? []);
  return parameterText.includes("eventID") || parameterText.includes("event_id");
}

function isAdvertisingTag(tag: GtmTag): boolean {
  if (ADVERTISING_TAG_TYPES.has(tag.type)) {
    return true;
  }
  return isAdVendor(getTagSearchText(tag));
}

function isAnalyticsTag(tag: GtmTag): boolean {
  if (ANALYTICS_TAG_TYPES.has(tag.type)) {
    return true;
  }

  if (isAdvertisingTag(tag)) {
    return false;
  }

  return isAnalyticsVendor(getTagSearchText(tag));
}

function isMetaTag(tag: GtmTag): boolean {
  const searchText = getTagSearchText(tag);
  return VENDOR_ALIAS_PATTERNS.meta.some((pattern) => pattern.test(searchText));
}

function matchVendor(tag: GtmTag, vendor: string): boolean {
  const searchText = getTagSearchText(tag);
  const patterns = VENDOR_ALIAS_PATTERNS[vendor.toLowerCase()] ?? [
    new RegExp(escapeRegex(vendor), "i"),
  ];
  return patterns.some((pattern) => pattern.test(searchText));
}

export function isGoogleAdsMeasurementTag(tag: GtmTag): boolean {
  if (GOOGLE_ADS_MEASUREMENT_TAG_TYPES.has(tag.type)) {
    return true;
  }

  if (!matchVendor(tag, "google ads")) {
    return false;
  }

  if (tag.type === "gclidw") {
    return false;
  }

  const searchText = getTagSearchText(tag);
  return GOOGLE_ADS_MEASUREMENT_PATTERNS.some((pattern) => pattern.test(searchText));
}

function getVendorRequiredConsentSignals(
  vendor: string,
  tag: GtmTag,
  configuredSignals: GtmConsentSignalValue[],
): GtmConsentSignalValue[] {
  if (vendor.toLowerCase() === "google ads" && !isGoogleAdsMeasurementTag(tag)) {
    return configuredSignals.filter((signal) => signal === "ad_storage");
  }

  return configuredSignals;
}

export function getAdvertisingConsentSignals(tag: GtmTag): GtmConsentSignalValue[] {
  if (!isAdvertisingTag(tag)) {
    return [];
  }

  if (isLightweightPixel(getTagSearchText(tag))) {
    return ["ad_storage"];
  }

  return isGoogleAdsMeasurementTag(tag)
    ? ["ad_storage", "ad_user_data", "ad_personalization"]
    : ["ad_storage"];
}

export function getRequiredConsentSignalsForTag(
  tag: GtmTag,
  vendorConsentMatrix: Record<string, GtmConsentSignalValue[]> = DEFAULT_VENDOR_CONSENT_MATRIX,
): GtmConsentSignalValue[] {
  if (tag.paused) {
    return [];
  }

  const requiredSignals = new Set<GtmConsentSignalValue>();

  for (const signal of getAdvertisingConsentSignals(tag)) {
    requiredSignals.add(signal);
  }

  if (isAnalyticsTag(tag)) {
    requiredSignals.add("analytics_storage");
  }

  for (const [vendor, configuredSignals] of Object.entries(vendorConsentMatrix)) {
    if (!matchVendor(tag, vendor)) {
      continue;
    }

    for (const signal of getVendorRequiredConsentSignals(vendor, tag, configuredSignals)) {
      requiredSignals.add(signal);
    }
  }

  return [...requiredSignals];
}

export function getMissingRequiredConsentSignalsForTag(
  tag: GtmTag,
  vendorConsentMatrix: Record<string, GtmConsentSignalValue[]> = DEFAULT_VENDOR_CONSENT_MATRIX,
): GtmConsentSignalValue[] {
  return getMissingConsentSignals(tag, getRequiredConsentSignalsForTag(tag, vendorConsentMatrix));
}

function hasServerContainerIndicator(tag: GtmTag): boolean {
  const searchText = getTagSearchText(tag);
  return SERVER_CONTAINER_PATTERNS.some((pattern) => pattern.test(searchText));
}

function isMetaCapiTag(tag: GtmTag): boolean {
  if (!isMetaTag(tag)) {
    return false;
  }

  const searchText = getTagSearchText(tag);
  return META_CAPI_PATTERNS.some((pattern) => pattern.test(searchText));
}

function isMetaEventTag(tag: GtmTag): boolean {
  if (!isMetaTag(tag)) {
    return false;
  }

  const searchText = getTagSearchText(tag);
  if (isMetaCapiTag(tag)) {
    return false;
  }

  return META_EVENT_PATTERNS.some((pattern) => pattern.test(searchText));
}

export function hasMetaDedupContext(tags: GtmTag[]): boolean {
  return tags.some(
    (tag) => !tag.paused && (isMetaCapiTag(tag) || hasServerContainerIndicator(tag)),
  );
}

export function shouldRequireMetaEventId(tag: GtmTag, tags: GtmTag[]): boolean {
  return !tag.paused && hasMetaDedupContext(tags) && isMetaEventTag(tag);
}

export function getMetaTagsMissingEventId(tags: GtmTag[]): GtmTag[] {
  return tags.filter((tag) => shouldRequireMetaEventId(tag, tags) && !hasEventId(tag));
}

export function isSpaTrigger(trigger: GtmTrigger): boolean {
  const nameLower = trigger.name.toLowerCase();

  if (trigger.type === "HISTORY_CHANGE") {
    return true;
  }

  if (
    nameLower.includes("spa") ||
    nameLower.includes("route") ||
    nameLower.includes("history") ||
    nameLower.includes("virtual page") ||
    nameLower.includes("page view")
  ) {
    return true;
  }

  if (trigger.type === "CUSTOM_EVENT" && matchesCustomEventTrigger(trigger, "page_view")) {
    return true;
  }

  const serializedFilters = JSON.stringify(trigger.customEventFilter ?? []);
  return /page_view|ce_page_view|route_change|history_change/i.test(serializedFilters);
}

export function getSpaTriggersForTag(tag: Pick<GtmTag, "firingTriggerId">, triggers: GtmTrigger[]) {
  const firingTriggerIds = new Set(tag.firingTriggerId ?? []);
  return triggers.filter(
    (trigger) => firingTriggerIds.has(trigger.triggerId) && isSpaTrigger(trigger),
  );
}

export function tagUsesSpaTrigger(tag: Pick<GtmTag, "firingTriggerId">, triggers: GtmTrigger[]) {
  return getSpaTriggersForTag(tag, triggers).length > 0;
}

function createViolation(
  policy: Pick<Policy, "id" | "name" | "severity" | "category">,
  resourceType: PolicyResourceType,
  resourceId: string,
  resourceName: string,
  message: string,
): PolicyViolation {
  return {
    policyId: policy.id,
    policyName: policy.name,
    severity: policy.severity,
    category: policy.category,
    resourceType,
    resourceId,
    resourceName,
    message,
  };
}

function createTagViolation(policy: Policy, tag: GtmTag, message: string): PolicyViolation {
  return createViolation(policy, "tag", tag.tagId, tag.name, message);
}

function createTriggerViolation(
  policy: Policy,
  trigger: GtmTrigger,
  message: string,
): PolicyViolation {
  return createViolation(policy, "trigger", trigger.triggerId, trigger.name, message);
}

function matchesNameRule(
  name: string,
  prefixes?: string[],
  pattern?: RegExp,
  fallback?: RegExp,
): boolean {
  if (prefixes && prefixes.length > 0) {
    return prefixes.some((prefix) => name.startsWith(prefix));
  }

  if (pattern) {
    return pattern.test(name);
  }

  return fallback ? fallback.test(name) : true;
}

function getUsedTriggerIds(tags: GtmTag[]): Set<string> {
  const used = new Set<string>();

  for (const tag of tags) {
    for (const triggerId of tag.firingTriggerId ?? []) {
      used.add(triggerId);
    }
    for (const triggerId of tag.blockingTriggerId ?? []) {
      used.add(triggerId);
    }
  }

  return used;
}

function normalizeCustomPolicy(
  definition: CustomPolicyDefinition,
  index: number,
): NormalizedCustomPolicy {
  if (!definition.id || !definition.name || !definition.description) {
    throw new Error(`Invalid customPolicies[${index}]: id, name, and description are required`);
  }

  const requireConfig = definition.require ?? {};
  const normalized: NormalizedCustomPolicy = {
    id: definition.id,
    name: definition.name,
    description: definition.description,
    severity: normalizeSeverity(definition.severity, `${definition.id}.severity`) ?? "warning",
    category: normalizeCategory(definition.category, `${definition.id}.category`),
    target: normalizeTarget(definition.target, `${definition.id}.target`),
    match: {
      nameIncludes: normalizeStringList(
        definition.match?.nameIncludes,
        `${definition.id}.match.nameIncludes`,
      ),
      namePattern: parseOptionalRegex(
        definition.match?.namePattern,
        `${definition.id}.match.namePattern`,
      ),
      typeIn: normalizeStringList(definition.match?.typeIn, `${definition.id}.match.typeIn`),
      htmlIncludes: normalizeStringList(
        definition.match?.htmlIncludes,
        `${definition.id}.match.htmlIncludes`,
      ),
      vendorIn: normalizeStringList(definition.match?.vendorIn, `${definition.id}.match.vendorIn`),
      firingTriggerTypes: normalizeStringList(
        definition.match?.firingTriggerTypes,
        `${definition.id}.match.firingTriggerTypes`,
      ),
    },
    require: {
      consentSignals: normalizeStringList(
        requireConfig.consentSignals,
        `${definition.id}.require.consentSignals`,
      ),
      namePrefixes: normalizeStringList(
        requireConfig.namePrefixes,
        `${definition.id}.require.namePrefixes`,
      ),
      htmlIncludes: normalizeStringList(
        requireConfig.htmlIncludes,
        `${definition.id}.require.htmlIncludes`,
      ),
      eventId: normalizeOptionalBoolean(requireConfig.eventId, `${definition.id}.require.eventId`),
      noDocumentWrite: normalizeOptionalBoolean(
        requireConfig.noDocumentWrite,
        `${definition.id}.require.noDocumentWrite`,
      ),
      firingOptionNot: normalizeStringList(
        requireConfig.firingOptionNot,
        `${definition.id}.require.firingOptionNot`,
      ),
      used: normalizeOptionalBoolean(requireConfig.used, `${definition.id}.require.used`),
    },
  };

  const hasRequirement = Object.values(normalized.require).some((value) =>
    Array.isArray(value) ? value.length > 0 : value === true,
  );

  if (!hasRequirement) {
    throw new Error(`Invalid customPolicies[${index}]: at least one require.* rule is required`);
  }

  return normalized;
}

function matchesCustomTag(
  tag: GtmTag,
  triggers: GtmTrigger[],
  policy: NormalizedCustomPolicy,
): boolean {
  const html = getHtml(tag).toLowerCase();
  const firingTriggers = triggers.filter((trigger) =>
    (tag.firingTriggerId ?? []).includes(trigger.triggerId),
  );

  if (
    policy.match.nameIncludes &&
    !policy.match.nameIncludes.some((fragment) =>
      tag.name.toLowerCase().includes(fragment.toLowerCase()),
    )
  ) {
    return false;
  }

  if (policy.match.namePattern && !policy.match.namePattern.test(tag.name)) {
    return false;
  }

  if (policy.match.typeIn && !policy.match.typeIn.includes(tag.type)) {
    return false;
  }

  if (
    policy.match.htmlIncludes &&
    !policy.match.htmlIncludes.some((fragment) => html.includes(fragment.toLowerCase()))
  ) {
    return false;
  }

  if (policy.match.vendorIn && !policy.match.vendorIn.some((vendor) => matchVendor(tag, vendor))) {
    return false;
  }

  if (
    policy.match.firingTriggerTypes &&
    !firingTriggers.some((trigger) => policy.match.firingTriggerTypes?.includes(trigger.type))
  ) {
    return false;
  }

  return true;
}

function matchesCustomTrigger(trigger: GtmTrigger, policy: NormalizedCustomPolicy): boolean {
  if (
    policy.match.nameIncludes &&
    !policy.match.nameIncludes.some((fragment) =>
      trigger.name.toLowerCase().includes(fragment.toLowerCase()),
    )
  ) {
    return false;
  }

  if (policy.match.namePattern && !policy.match.namePattern.test(trigger.name)) {
    return false;
  }

  if (policy.match.typeIn && !policy.match.typeIn.includes(trigger.type)) {
    return false;
  }

  return true;
}

function getCustomTagViolations(
  policy: Policy,
  tag: GtmTag,
  normalized: NormalizedCustomPolicy,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];
  const html = getHtml(tag).toLowerCase();
  const missingSignals = normalized.require.consentSignals?.length
    ? getMissingConsentSignals(tag, normalized.require.consentSignals)
    : [];

  if (missingSignals.length > 0) {
    violations.push(
      createTagViolation(policy, tag, `Missing consent signals: ${missingSignals.join(", ")}`),
    );
  }

  if (
    normalized.require.namePrefixes &&
    !normalized.require.namePrefixes.some((prefix) => tag.name.startsWith(prefix))
  ) {
    violations.push(
      createTagViolation(
        policy,
        tag,
        `Name should start with one of: ${normalized.require.namePrefixes.join(", ")}`,
      ),
    );
  }

  if (
    normalized.require.htmlIncludes &&
    !normalized.require.htmlIncludes.some((fragment) => html.includes(fragment.toLowerCase()))
  ) {
    violations.push(
      createTagViolation(
        policy,
        tag,
        `HTML or parameters should include one of: ${normalized.require.htmlIncludes.join(", ")}`,
      ),
    );
  }

  if (normalized.require.eventId && !hasEventId(tag)) {
    violations.push(createTagViolation(policy, tag, "Missing eventID/event_id for deduplication"));
  }

  if (normalized.require.noDocumentWrite && hasDocumentWriteEnabled(tag)) {
    violations.push(createTagViolation(policy, tag, "supportDocumentWrite must not be enabled"));
  }

  if (normalized.require.firingOptionNot) {
    const currentFiringOption = tag.tagFiringOption ?? "unlimited";
    if (normalized.require.firingOptionNot.includes(currentFiringOption)) {
      violations.push(
        createTagViolation(policy, tag, `Firing option must not be ${currentFiringOption}`),
      );
    }
  }

  return violations;
}

function getCustomTriggerViolations(
  policy: Policy,
  trigger: GtmTrigger,
  normalized: NormalizedCustomPolicy,
  usedTriggerIds: Set<string>,
): PolicyViolation[] {
  const violations: PolicyViolation[] = [];

  if (
    normalized.require.namePrefixes &&
    !normalized.require.namePrefixes.some((prefix) => trigger.name.startsWith(prefix))
  ) {
    violations.push(
      createTriggerViolation(
        policy,
        trigger,
        `Name should start with one of: ${normalized.require.namePrefixes.join(", ")}`,
      ),
    );
  }

  if (normalized.require.used && !usedTriggerIds.has(trigger.triggerId)) {
    violations.push(createTriggerViolation(policy, trigger, "Trigger is not used by any tag"));
  }

  return violations;
}

function createCustomPolicy(normalized: NormalizedCustomPolicy): Policy {
  const policy: Policy = {
    id: normalized.id,
    name: normalized.name,
    description: normalized.description,
    severity: normalized.severity,
    category: normalized.category,
    check(tag, triggers) {
      if (normalized.target !== "tag" || tag.paused) {
        return [];
      }

      if (!matchesCustomTag(tag, triggers, normalized)) {
        return [];
      }

      return getCustomTagViolations(policy, tag, normalized);
    },
  };

  if (normalized.target === "trigger") {
    policy.checkWorkspace = (tags, triggers) => {
      const usedTriggerIds = getUsedTriggerIds(tags);
      const violations: PolicyViolation[] = [];

      for (const trigger of triggers) {
        if (!matchesCustomTrigger(trigger, normalized)) {
          continue;
        }

        violations.push(...getCustomTriggerViolations(policy, trigger, normalized, usedTriggerIds));
      }

      return violations;
    };
  }

  return policy;
}

function buildNamingConventionPolicy(config: NormalizedNamingConfig): Policy {
  const policy: Policy = {
    id: "naming-convention",
    name: "Naming Convention",
    description: "Tags and triggers should follow prefixed naming conventions.",
    severity: "warning",
    category: "naming",
    check(tag) {
      if (tag.paused) {
        return [];
      }

      if (
        matchesNameRule(tag.name, config.tagPrefixes, config.tagPattern, DEFAULT_TAG_PREFIX_PATTERN)
      ) {
        return [];
      }

      const expected = config.tagPrefixes?.join(", ") ?? "Prefix - Name";
      return [
        createTagViolation(policy, tag, `Tag name should use a prefixed format (${expected})`),
      ];
    },
    checkWorkspace(_tags, triggers) {
      return triggers
        .filter(
          (trigger) =>
            !BUILTIN_TRIGGER_IDS.has(trigger.triggerId) &&
            !matchesNameRule(
              trigger.name,
              config.triggerPrefixes,
              config.triggerPattern,
              DEFAULT_TRIGGER_PREFIX_PATTERN,
            ),
        )
        .map((trigger) => {
          const expected = config.triggerPrefixes?.join(", ") ?? "CE - Name";
          return createTriggerViolation(
            policy,
            trigger,
            `Trigger name should use a prefixed format (${expected})`,
          );
        });
    },
  };

  return policy;
}

function buildVendorConsentMatrixPolicy(
  vendorConsentMatrix: Record<string, GtmConsentSignalValue[]>,
): Policy {
  const policy: Policy = {
    id: "vendor-consent-matrix",
    name: "Vendor Consent Matrix",
    description: "Known vendors must declare the consent signals required by their platform.",
    severity: "error",
    category: "vendor",
    check(tag) {
      if (tag.paused) {
        return [];
      }

      const violations: PolicyViolation[] = [];
      const seenMessages = new Set<string>();

      for (const [vendor, requiredSignals] of Object.entries(vendorConsentMatrix)) {
        if (!matchVendor(tag, vendor)) {
          continue;
        }

        const missingSignals = getMissingConsentSignals(
          tag,
          getVendorRequiredConsentSignals(vendor, tag, requiredSignals),
        );
        if (missingSignals.length === 0) {
          continue;
        }

        const message = `${vendor} requires consent signals: ${missingSignals.join(", ")}`;
        if (seenMessages.has(message)) {
          continue;
        }
        seenMessages.add(message);
        violations.push(createTagViolation(policy, tag, message));
      }

      return violations;
    },
  };

  return policy;
}

export function getBuiltInPolicies(config: PolicyFileConfig = {}): Policy[] {
  const namingConfig = normalizeNamingConfig(config.naming);
  const vendorConsentMatrix = normalizeVendorConsentMatrix(config.vendorConsentMatrix);

  const consentAdvertisingPolicy: Policy = {
    id: "consent-v2-advertising",
    name: "Consent Mode v2 Advertising",
    description:
      "Advertising tags require ad_storage, with ad_user_data/ad_personalization reserved for Google Ads measurement tags.",
    severity: "error",
    category: "consent",
    check(tag) {
      if (tag.paused) {
        return [];
      }

      const requiredSignals = getAdvertisingConsentSignals(tag);
      const missingSignals = getMissingConsentSignals(tag, requiredSignals);

      return missingSignals.length > 0
        ? [
            createTagViolation(
              consentAdvertisingPolicy,
              tag,
              `Advertising tags require: ${missingSignals.join(", ")}`,
            ),
          ]
        : [];
    },
  };

  const consentAnalyticsPolicy: Policy = {
    id: "consent-v2-analytics",
    name: "Consent Mode v2 Analytics",
    description: "Analytics tags must require analytics_storage.",
    severity: "error",
    category: "consent",
    check(tag) {
      if (tag.paused || !isAnalyticsTag(tag)) {
        return [];
      }

      const missingSignals = getMissingConsentSignals(tag, ["analytics_storage"]);
      return missingSignals.length > 0
        ? [
            createTagViolation(
              consentAnalyticsPolicy,
              tag,
              "Analytics tags require analytics_storage",
            ),
          ]
        : [];
    },
  };

  const spaFiringSafetyPolicy: Policy = {
    id: "spa-firing-safety",
    name: "SPA Firing Safety",
    description: "Tags attached to SPA-style triggers should not use unlimited firing.",
    severity: "warning",
    category: "firing",
    check(tag, triggers) {
      if (tag.paused) {
        return [];
      }

      const currentFiringOption = tag.tagFiringOption ?? "unlimited";
      if (currentFiringOption !== "unlimited") {
        return [];
      }

      if (!tagUsesSpaTrigger(tag, triggers)) {
        return [];
      }

      return [
        createTagViolation(
          spaFiringSafetyPolicy,
          tag,
          "Uses unlimited firing on an SPA-style trigger; use oncePerEvent or oncePerLoad",
        ),
      ];
    },
  };

  const noDocumentWritePolicy: Policy = {
    id: "no-document-write",
    name: "No Document Write",
    description: "Tags should not enable supportDocumentWrite.",
    severity: "error",
    category: "security",
    check(tag) {
      if (tag.paused || !hasDocumentWriteEnabled(tag)) {
        return [];
      }

      return [createTagViolation(noDocumentWritePolicy, tag, "supportDocumentWrite is enabled")];
    },
  };

  const metaDedupPolicy: Policy = {
    id: "meta-dedup",
    name: "Meta Deduplication",
    description: "Meta pixel tags must include eventID/event_id for browser-server deduplication.",
    severity: "error",
    category: "vendor",
    check(tag) {
      return [];
    },
    checkWorkspace(tags) {
      return getMetaTagsMissingEventId(tags).map((tag) =>
        createTagViolation(
          metaDedupPolicy,
          tag,
          "Meta pixel tag is missing eventID/event_id for deduplication",
        ),
      );
    },
  };

  const noOrphanedTriggersPolicy: Policy = {
    id: "no-orphaned-triggers",
    name: "No Orphaned Triggers",
    description: "Triggers should be referenced by at least one tag.",
    severity: "info",
    category: "performance",
    check() {
      return [];
    },
    checkWorkspace(tags, triggers) {
      const usedTriggerIds = getUsedTriggerIds(tags);

      return triggers
        .filter(
          (trigger) =>
            !BUILTIN_TRIGGER_IDS.has(trigger.triggerId) && !usedTriggerIds.has(trigger.triggerId),
        )
        .map((trigger) =>
          createTriggerViolation(
            noOrphanedTriggersPolicy,
            trigger,
            "Trigger is not used by any tag",
          ),
        );
    },
  };

  const builtInPolicies = [
    consentAdvertisingPolicy,
    consentAnalyticsPolicy,
    spaFiringSafetyPolicy,
    noDocumentWritePolicy,
    metaDedupPolicy,
    buildNamingConventionPolicy(namingConfig),
    noOrphanedTriggersPolicy,
    buildVendorConsentMatrixPolicy(vendorConsentMatrix),
  ];

  return [...builtInPolicies];
}

export function loadPolicyConfig(configPath?: string): PolicyFileConfig {
  const targetPath = resolve(configPath ?? POLICY_CONFIG_FILENAME);
  if (!existsSync(targetPath)) {
    return {};
  }

  try {
    const raw = readFileSync(targetPath, "utf-8");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed)) {
      throw new Error("Top-level JSON value must be an object");
    }
    return parsed as PolicyFileConfig;
  } catch (err) {
    throw new Error(`Failed to parse policy config at ${targetPath}: ${(err as Error).message}`);
  }
}

export function buildPolicySet(config: PolicyFileConfig = {}): Policy[] {
  const builtInPolicies = getBuiltInPolicies(config);
  const customPolicyDefinitions = config.customPolicies ?? [];
  if (!Array.isArray(customPolicyDefinitions)) {
    throw new Error("Invalid customPolicies: expected an array");
  }

  const enabledPolicyIds = normalizeStringList(config.enabledPolicies, "enabledPolicies");
  const disabledPolicyIds = normalizeStringList(config.disabledPolicies, "disabledPolicies");

  const customPolicies = customPolicyDefinitions.map((definition, index) =>
    createCustomPolicy(normalizeCustomPolicy(definition, index)),
  );
  const allPolicies = [...builtInPolicies, ...customPolicies];
  const policyMap = new Map<string, Policy>();

  for (const policy of allPolicies) {
    if (policyMap.has(policy.id)) {
      throw new Error(`Duplicate policy id: ${policy.id}`);
    }
    policyMap.set(policy.id, policy);
  }

  let enabled = allPolicies;

  if (enabledPolicyIds && enabledPolicyIds.length > 0) {
    enabled = enabledPolicyIds.map((policyId) => {
      const policy = policyMap.get(policyId);
      if (!policy) {
        throw new Error(`Unknown policy in enabledPolicies: ${policyId}`);
      }
      return policy;
    });
  }

  if (disabledPolicyIds && disabledPolicyIds.length > 0) {
    const disabled = new Set(disabledPolicyIds);
    enabled = enabled.filter((policy) => !disabled.has(policy.id));
  }

  return enabled;
}

export function loadPoliciesFromConfig(configPath?: string): Policy[] {
  return buildPolicySet(loadPolicyConfig(configPath));
}

function normalizeEnabledPolicies(enabledPolicies?: Array<Policy | string>): Policy[] {
  if (!enabledPolicies || enabledPolicies.length === 0) {
    return getBuiltInPolicies();
  }

  if (typeof enabledPolicies[0] !== "string") {
    return enabledPolicies as Policy[];
  }

  const builtInPolicyMap = new Map(getBuiltInPolicies().map((policy) => [policy.id, policy]));
  return (enabledPolicies as string[]).map((policyId) => {
    const policy = builtInPolicyMap.get(policyId);
    if (!policy) {
      throw new Error(`Unknown built-in policy: ${policyId}`);
    }
    return policy;
  });
}

export function evaluatePolicies(
  tags: GtmTag[],
  triggers: GtmTrigger[],
  variables: GtmVariable[],
  enabledPolicies?: Array<Policy | string>,
): PolicyReport {
  const policies = normalizeEnabledPolicies(enabledPolicies);
  const violations: PolicyViolation[] = [];

  for (const policy of policies) {
    for (const tag of tags) {
      violations.push(...policy.check(tag, triggers, variables));
    }

    if (policy.checkWorkspace) {
      violations.push(...policy.checkWorkspace(tags, triggers, variables));
    }
  }

  violations.sort((left, right) => {
    if (SEVERITY_ORDER[left.severity] !== SEVERITY_ORDER[right.severity]) {
      return SEVERITY_ORDER[left.severity] - SEVERITY_ORDER[right.severity];
    }
    if (left.category !== right.category) {
      return left.category.localeCompare(right.category);
    }
    if (left.resourceType !== right.resourceType) {
      return left.resourceType.localeCompare(right.resourceType);
    }
    return left.resourceName.localeCompare(right.resourceName);
  });

  const errors = violations.filter((violation) => violation.severity === "error").length;
  const warnings = violations.filter((violation) => violation.severity === "warning").length;
  const info = violations.filter((violation) => violation.severity === "info").length;

  return {
    timestamp: new Date().toISOString(),
    enabledPolicies: policies.map((policy) => policy.id),
    violations,
    passed: errors === 0,
    summary: {
      errors,
      warnings,
      info,
      total: violations.length,
    },
    resources: {
      tags: tags.length,
      triggers: triggers.length,
      variables: variables.length,
    },
  };
}

export function printPolicyReport(report: PolicyReport): void {
  console.log(chalk.bold("\n  Policy Check Report\n"));
  console.log(`  Policies:  ${chalk.gray(String(report.enabledPolicies.length))}`);
  console.log(
    `  Scope:     ${chalk.gray(`${report.resources.tags} tags, ${report.resources.triggers} triggers, ${report.resources.variables} variables`)}`,
  );
  console.log();

  if (report.violations.length === 0) {
    console.log(chalk.green.bold("  ✔ No policy violations found.\n"));
    return;
  }

  for (const violation of report.violations) {
    const icon =
      violation.severity === "error"
        ? chalk.red("✖")
        : violation.severity === "warning"
          ? chalk.yellow("⚠")
          : chalk.blue("ℹ");
    const label =
      violation.severity === "error"
        ? chalk.red("ERROR")
        : violation.severity === "warning"
          ? chalk.yellow("WARN")
          : chalk.blue("INFO");

    console.log(
      `  ${icon} ${label} ${chalk.gray(`[${violation.resourceType}]`)} ${violation.resourceName} ${chalk.gray(`(${violation.resourceId})`)}`,
    );
    console.log(`      ${violation.message}`);
    console.log(
      `      ${chalk.gray(`Policy: ${violation.policyId} · Category: ${violation.category}`)}\n`,
    );
  }

  const summaryColor = report.summary.errors
    ? chalk.red
    : report.summary.warnings
      ? chalk.yellow
      : chalk.blue;
  console.log(
    summaryColor(
      `  Summary: ${report.summary.errors} errors, ${report.summary.warnings} warnings, ${report.summary.info} info`,
    ),
  );
  console.log();
}
