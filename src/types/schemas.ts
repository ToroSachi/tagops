import { z } from "zod";

// ── Parameter Schema ──
// z.ZodType<any> annotation is required to allow recursive list/map self-reference
export const GtmParameterSchema: z.ZodType<any> = z.object({
  type: z.enum([
    "template",
    "boolean",
    "integer",
    "list",
    "map",
    "trigger_reference",
    "tag_reference",
    "TEMPLATE",
    "BOOLEAN",
    "INTEGER",
  ]),
  key: z.string().optional(),
  value: z.any().optional(),
  list: z.array(z.lazy(() => GtmParameterSchema)).optional(),
  map: z.array(z.lazy(() => GtmParameterSchema)).optional(),
});

// ── Consent Settings ──
// Matches GtmConsentSettings exactly — consentStatus is required when the block exists
export const ConsentSettingsSchema = z
  .object({
    consentStatus: z.enum(["needed", "notNeeded", "notSet"]),
    consentType: z
      .object({
        type: z.literal("list"),
        list: z.array(z.object({ type: z.string(), value: z.string() })).optional(),
      })
      .optional(),
  })
  .passthrough(); // Allow unknown GTM API fields through without rejection

// ── Resource Schemas ──
// Each uses .passthrough() so undocumented GTM API fields (like parentFolderId) survive validation
export const GtmTagSchema = z
  .object({
    tagId: z.string(),
    name: z.string(),
    type: z.string(),
    parameter: z.array(GtmParameterSchema).optional(),
    fingerprint: z.string(), // Required — GTM API always returns this
    firingTriggerId: z.array(z.string()).optional(),
    blockingTriggerId: z.array(z.string()).optional(),
    tagFiringOption: z.string().optional(),
    paused: z.boolean().optional(),
    consentSettings: ConsentSettingsSchema.optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const GtmTriggerSchema = z
  .object({
    triggerId: z.string(),
    name: z.string(),
    type: z.string(),
    filter: z.array(z.any()).optional(),
    customEventFilter: z.array(z.any()).optional(),
    parameter: z.array(GtmParameterSchema).optional(),
    fingerprint: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const GtmVariableSchema = z
  .object({
    variableId: z.string(),
    name: z.string(),
    type: z.string(),
    parameter: z.array(GtmParameterSchema).optional(),
    fingerprint: z.string().optional(),
    notes: z.string().optional(),
  })
  .passthrough();

export const GtmFolderSchema = z
  .object({
    folderId: z.string(),
    name: z.string(),
    notes: z.string().optional(),
    path: z.string(),
    fingerprint: z.string(),
    accountId: z.string().optional(),
    containerId: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough();

export const GtmBuiltInVariableSchema = z
  .object({
    name: z.string(),
    type: z.string(),
    path: z.string(),
    accountId: z.string().optional(),
    containerId: z.string().optional(),
    workspaceId: z.string().optional(),
  })
  .passthrough();

export const GtmGalleryReferenceSchema = z
  .object({
    galleryTemplateId: z.string().optional(),
    host: z.string().optional(),
    isModified: z.boolean().optional(),
    owner: z.string().optional(),
    repository: z.string().optional(),
    signature: z.string().optional(),
    templateDeveloperId: z.string().optional(),
    version: z.string().optional(),
  })
  .passthrough();

export const GtmCustomTemplateSchema = z
  .object({
    templateId: z.string(),
    name: z.string(),
    templateData: z.string(),
    galleryReference: GtmGalleryReferenceSchema.optional(),
    fingerprint: z.string(),
    path: z.string(),
  })
  .passthrough();

const GtmConditionSchema = z
  .object({
    type: z.string(),
    parameter: z.array(GtmParameterSchema).optional(),
  })
  .passthrough();

const GtmZoneChildContainerSchema = z
  .object({
    nickname: z.string().optional(),
    publicId: z.string().optional(),
  })
  .passthrough();

const GtmZoneTypeRestrictionSchema = z
  .object({
    enable: z.boolean().optional(),
    whitelistedTypeId: z.array(z.string()).optional(),
  })
  .passthrough();

const GtmZoneBoundarySchema = z
  .object({
    condition: z.array(GtmConditionSchema).optional(),
    customEvaluationTriggerId: z.array(z.string()).optional(),
  })
  .passthrough();

export const GtmZoneSchema = z
  .object({
    zoneId: z.string(),
    name: z.string(),
    childContainer: z.array(GtmZoneChildContainerSchema).optional(),
    typeRestriction: GtmZoneTypeRestrictionSchema.optional(),
    boundary: GtmZoneBoundarySchema.optional(),
    notes: z.string().optional(),
    fingerprint: z.string(),
    path: z.string(),
  })
  .passthrough();

export const GtmEnvironmentSchema = z
  .object({
    environmentId: z.string(),
    name: z.string(),
    description: z.string().optional(),
    type: z.string(),
    url: z.string().optional(),
    fingerprint: z.string(),
    path: z.string(),
  })
  .passthrough();

export const SnapshotSchema = z.object({
  schemaVersion: z.literal("1.0"),
  meta: z.object({
    timestamp: z.string(),
    sourceProfile: z.string().optional(),
    toolName: z.string().optional(),
    accountId: z.string().optional(),
    containerId: z.string().optional(),
    workspaceId: z.string().optional(),
    description: z.string().optional(),
  }),
  tags: z.array(GtmTagSchema),
  triggers: z.array(GtmTriggerSchema),
  variables: z.array(GtmVariableSchema),
  folders: z.array(GtmFolderSchema).optional(),
  builtInVariables: z.array(GtmBuiltInVariableSchema).optional(),
  customTemplates: z.array(GtmCustomTemplateSchema).optional(),
  zones: z.array(GtmZoneSchema).optional(),
  environments: z.array(GtmEnvironmentSchema).optional(),
});

export type SnapshotData = z.infer<typeof SnapshotSchema>;

/**
 * Validates a raw JSON string against the strict GTM Snapshot schema.
 * Auto-migrates legacy snapshot formats that predate schemaVersion.
 * Throws a ZodError with a clear message if validation fails.
 */
export function parseSnapshot(jsonString: string): SnapshotData {
  let raw: any;
  try {
    raw = JSON.parse(jsonString);
  } catch {
    throw new Error("Snapshot file is not valid JSON. Check for corruption or encoding issues.");
  }

  // Auto-migrate legacy snapshots that lack a schemaVersion
  if (!raw.schemaVersion) {
    raw.schemaVersion = "1.0";
    if (!raw.meta) {
      // Preserve legacy account data if available
      const legacy = raw.account || {};
      raw.meta = {
        timestamp: raw.timestamp || new Date().toISOString(),
        accountId: legacy.accountId,
        containerId: legacy.containerId,
        workspaceId: legacy.workspaceId,
        description: "Legacy snapshot auto-migrated",
      };
    }
  }

  try {
    return SnapshotSchema.parse(raw);
  } catch (err: any) {
    const issues =
      err.issues?.map((i: any) => `  → ${i.path.join(".")}: ${i.message}`).join("\n") ?? "";
    throw new Error(
      `Snapshot validation failed:\n${issues}\n\nThis usually means the snapshot was created with an older version or has been manually edited.`,
    );
  }
}
