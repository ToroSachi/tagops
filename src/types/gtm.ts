/**
 * GTM API Type Definitions
 *
 * Complete type definitions for objects returned by the tagmanager_v2 API.
 * These match the Google Tag Manager API v2 resource shapes.
 */

export type GtmAccountPermission = "noAccess" | "read" | "user" | "admin";
export type GtmContainerPermission = "noAccess" | "read" | "edit" | "approve" | "publish";

export interface GtmAccountAccess {
  permission: GtmAccountPermission;
}

export interface GtmContainerAccess {
  containerId: string;
  permission: GtmContainerPermission;
}

export interface GtmUserPermission {
  emailAddress: string;
  accountAccess: GtmAccountAccess;
  containerAccess: GtmContainerAccess[];
}

// ── Parameter types ──

export interface GtmParameter {
  type:
    | "template"
    | "boolean"
    | "integer"
    | "list"
    | "map"
    | "trigger_reference"
    | "tag_reference"
    | "TEMPLATE"
    | "BOOLEAN"
    | "INTEGER";
  key?: string;
  value?: string;
  list?: GtmParameter[];
  map?: GtmParameter[];
}

// ── Consent ──

export type GtmConsentSignal =
  | "ad_storage"
  | "analytics_storage"
  | "ad_user_data"
  | "ad_personalization"
  | "functionality_storage"
  | "personalization_storage"
  | "security_storage";

// eslint-disable-next-line @typescript-eslint/ban-types
export type GtmConsentSignalValue = GtmConsentSignal | (string & {});
export type GtmConsentSignalInput = GtmConsentSignalValue | GtmConsentSignalValue[];

export interface GtmConsentSettings {
  consentStatus: "needed" | "notNeeded" | "notSet";
  consentType?: {
    type: "list";
    list?: Array<{ type: string; value: GtmConsentSignalValue }>; // optional — GTM API may omit on empty
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

export interface GtmSetupTagReference {
  tagName: string;
  stopOnSetupFailure: boolean;
}

export interface GtmTeardownTagReference {
  tagName: string;
  stopTeardownOnFailure: boolean;
}

export interface GtmTag {
  tagId: string;
  name: string;
  type: string; // "gaawc" | "gaawe" | "html" | "img" | "googtag" | etc.
  firingTriggerId?: string[];
  blockingTriggerId?: string[];
  parameter?: GtmParameter[];
  consentSettings?: GtmConsentSettings;
  notes?: string;
  fingerprint: string;
  paused?: boolean;
  parentFolderId?: string;
  setupTag?: GtmSetupTagReference[];
  teardownTag?: GtmTeardownTagReference[];
  priority?: number;
  tagFiringOption?: string;
  firingOption?: string; // alias for tagFiringOption
  monitoringMetadata?: Record<string, unknown>;
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

// ── Folder ──

export interface GtmFolder {
  folderId: string;
  name: string;
  notes?: string;
  path: string;
  fingerprint: string;
  accountId?: string;
  containerId?: string;
  workspaceId?: string;
}

// ── Built-In Variable ──

export interface GtmBuiltInVariable {
  name: string;
  type: string;
  path: string;
  accountId?: string;
  containerId?: string;
  workspaceId?: string;
}

// ── Client ──

export interface GtmClient {
  clientId: string;
  name: string;
  type: string;
  parameter?: GtmParameter[];
  priority?: number;
  fingerprint: string;
  path: string;
  notes?: string;
  parentFolderId?: string;
  accountId?: string;
  containerId?: string;
  workspaceId?: string;
}

// ── Transformation ──

export interface GtmTransformation {
  transformationId: string;
  name: string;
  type: string;
  parameter?: GtmParameter[];
  fingerprint: string;
  path: string;
  notes?: string;
  parentFolderId?: string;
  accountId?: string;
  containerId?: string;
  workspaceId?: string;
}

// ── Custom Template ──

export interface GtmGalleryReference {
  galleryTemplateId?: string;
  host?: string;
  isModified?: boolean;
  owner?: string;
  repository?: string;
  signature?: string;
  templateDeveloperId?: string;
  version?: string;
}

export interface GtmCustomTemplate {
  templateId: string;
  name: string;
  templateData: string;
  galleryReference?: GtmGalleryReference;
  fingerprint: string;
  path: string;
}

// ── Zone ──

export interface GtmZoneChildContainer {
  nickname?: string;
  publicId?: string;
}

export interface GtmZoneTypeRestriction {
  enable?: boolean;
  whitelistedTypeId?: string[];
}

export interface GtmCondition {
  type: string;
  parameter?: GtmParameter[];
}

export interface GtmZoneBoundary {
  condition?: GtmCondition[];
  customEvaluationTriggerId?: string[];
}

export interface GtmZone {
  zoneId: string;
  name: string;
  childContainer?: GtmZoneChildContainer[];
  typeRestriction?: GtmZoneTypeRestriction;
  boundary?: GtmZoneBoundary;
  notes?: string;
  fingerprint: string;
  path: string;
}

// ── Environment ──

export interface GtmEnvironment {
  environmentId: string;
  name: string;
  description?: string;
  type: string;
  url?: string;
  fingerprint: string;
  path: string;
}

// ── Versions ──

export interface GtmVersionHeader {
  containerVersionId: string;
  name: string;
  description?: string;
  numTags?: string;
  numTriggers?: string;
  numVariables?: string;
  deleted?: boolean;
  fingerprint?: string;
  path: string;
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
  | "MISSING_SETUP_TAG"
  | "UNUSED_VARIABLE"
  | "PAUSED_TAG"
  | "BAD_NAMING_CONVENTION"
  | "WRONG_VARIABLE_PREFIX"
  | "WRONG_TRIGGER_PREFIX"
  | "GA4_MISSING_PARAMS"
  | "EXACT_DUPLICATE"
  | "LOW_FOLDER_USAGE"
  | "CUSTOM_HTML_RISK";

export type AuditSeverity = "critical" | "high" | "medium" | "low";

export interface AuditIssue {
  type: AuditIssueType;
  severity: AuditSeverity;
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
  | "personalization"
  | "security"
  | "custom_html"
  | "lightweight_pixel"
  | "unknown";

export interface ConsentSignalStatus {
  signal: GtmConsentSignalValue;
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
  consentType?: GtmConsentSignalInput;
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
  action: "CREATED" | "SKIPPED" | "DRY_RUN" | "ERROR";
  tagName: string;
  triggerId: string;
  html?: string;
  result?: string;
  error?: string;
}
