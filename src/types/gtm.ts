/**
 * GTM API Type Definitions
 *
 * Complete type definitions for objects returned by the tagmanager_v2 API.
 * These match the Google Tag Manager API v2 resource shapes.
 */

// ── Parameter types ──

export interface GtmParameter {
  type: "template" | "boolean" | "integer" | "list" | "map" | "TEMPLATE" | "BOOLEAN" | "INTEGER";
  key?: string;
  value?: string;
  list?: GtmParameter[];
  map?: GtmParameter[];
}

// ── Consent ──

export interface GtmConsentSettings {
  consentStatus: "needed" | "notNeeded" | "notSet";
  consentType?: {
    type: "list";
    list?: Array<{ type: string; value: string }>; // optional — GTM API may omit on empty
  };
}

// ── Filter / Condition ──

export interface GtmFilterCondition {
  type:
    | "EQUALS"
    | "CONTAINS"
    | "STARTS_WITH"
    | "ENDS_WITH"
    | "MATCHES_REGEX"
    | "GREATER"
    | "LESS"
    | "CSS_SELECTOR"
    | "URL_MATCHES";
  parameter: GtmParameter[];
  negate?: boolean;
}

// ── Tag ──

export interface GtmTag {
  tagId: string;
  name: string;
  type: string; // "gaawc" | "gaawe" | "html" | "img" | "googtag" | etc.
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  parameter?: GtmParameter[];
  consentSettings?: GtmConsentSettings;
  fingerprint: string;
  paused?: boolean;
  parentFolderId?: string;
  tagFiringOption?: string;
  monitoringMetadata?: GtmParameter;
  monitoringMetadataTagNameKey?: string;
}

// ── Trigger ──

export interface GtmTrigger {
  triggerId: string;
  name: string;
  type: string; // "CUSTOM_EVENT" | "PAGEVIEW" | "CLICK" | "ELEMENT_VISIBILITY" | etc.
  customEventFilter?: GtmFilterCondition[];
  filter?: GtmFilterCondition[];
  fingerprint?: string;
  parentFolderId?: string;
  notes?: string;
}

// ── Variable ──

export interface GtmVariable {
  variableId: string;
  name: string;
  type: string; // "v" | "c" | "jsm" | "u" | "k" | "j" | etc.
  parameter?: GtmParameter[];
  fingerprint?: string;
  parentFolderId?: string;
  notes?: string;
}

// ── Audit types ──

export type AuditIssueType =
  | "NO_TRIGGERS"
  | "WRONG_CONSENT"
  | "MISSING_EVENT_ID"
  | "ORPHANED_TRIGGER"
  | "CONSENT_NOT_SET"
  | "CONSENT_V2_MISSING_AD_STORAGE"
  | "CONSENT_V2_MISSING_AD_USER_DATA"
  | "CONSENT_V2_MISSING_AD_PERSONALIZATION"
  | "CONSENT_V2_MISSING_ANALYTICS_STORAGE"
  | "CONSENT_V2_NO_CONSENT_CONFIGURED"
  | "DUPLICATE_NAME"
  | "DOC_WRITE_ENABLED"
  | "UNLIMITED_FIRING"
  | "MISSING_VARIABLE_REF"
  | "UNUSED_VARIABLE"
  | "PAUSED_TAG"
  | "BAD_NAMING_CONVENTION"
  | "WRONG_VARIABLE_PREFIX"
  | "WRONG_TRIGGER_PREFIX"
  | "GA4_MISSING_PARAMS"
  | "EXACT_DUPLICATE"
  | "LOW_FOLDER_USAGE"
  | "CUSTOM_HTML_RISK";

export interface AuditIssue {
  type: AuditIssueType;
  tagId?: string;
  triggerId?: string;
  variableId?: string;
  name: string;
  detail?: string;
}

export interface AuditReport {
  totalTags: number;
  totalTriggers: number;
  issues: AuditIssue[];
  pausedTags: Array<{ id: string; name: string }>;
}

// ── Consent Mode v2 Audit ──

export type TagDataCategory =
  | "advertising"
  | "analytics"
  | "functional"
  | "custom_html"
  | "lightweight_pixel"
  | "unknown";

export interface ConsentSignalStatus {
  signal: string; // e.g. "ad_storage", "ad_user_data"
  required: boolean;
  present: boolean;
}

export interface ConsentTagAudit {
  tagId: string;
  name: string;
  type: string;
  category: TagDataCategory;
  consentStatus: "compliant" | "partial" | "non_compliant" | "not_configured";
  signals: ConsentSignalStatus[];
  recommendation?: string;
}

export interface ConsentAuditReport {
  timestamp: string;
  totalTags: number;
  auditedTags: number;
  compliantTags: number;
  partialTags: number;
  nonCompliantTags: number;
  notConfiguredTags: number;
  complianceScore: number; // 0-100
  tags: ConsentTagAudit[];
  summary: string;
}

// ── Tag creation/update helpers ──

export interface TagCreateOptions {
  name: string;
  type: string;
  html?: string;
  firingTriggerId: string;
  consentType?: string;
  parameter?: GtmParameter[];
}

export interface TagUpdateOptions {
  tagId: string;
  name: string;
  fingerprint: string;
  config: Record<string, unknown>;
  firingTriggerId?: string;
}

export interface TriggerCreateOptions {
  name: string;
  type: string;
  eventName?: string;
  pagePathFilter?: string;
}

// ── Pixel implementation ──

export interface PixelConfig {
  action: string;
  pageFilter?: string;
  dynamicValues?: Record<string, string>;
  contentId?: string;
}

export interface PixelImplementation {
  vendorName: string;
  pixelId: string;
  pixels: PixelConfig[];
  dryRun?: boolean;
}

export interface PixelResult {
  action: "CREATED" | "DRY_RUN" | "ERROR";
  tagName: string;
  triggerId: string;
  html?: string;
  result?: string;
  error?: string;
}
