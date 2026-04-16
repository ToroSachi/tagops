/**
 * Template Manifest — Portable JSON format for sharing TagOps templates
 *
 * A manifest is a self-contained JSON file that captures a hydrated template:
 * all the tags, triggers, variables, and consent settings needed to reproduce
 * a template installation in a different GTM container.
 *
 * Use cases:
 *   - Agency: "I set up Meta for Client A. Email this JSON to reuse for Client B."
 *   - CI/CD: Commit manifests to Git, install from them in pipelines.
 *   - Community: Publish verified configs on GitHub or Slack.
 *
 * Usage:
 *   tagops templates export meta-pixel --pixel-id 123456789 > meta-setup.json
 *   tagops templates import ./meta-setup.json
 */

import { readFileSync, existsSync } from "node:fs";
import chalk from "chalk";
import { extractedVendorTemplates } from "./vendors/index.js";
import type { IntegrationTemplate, TemplateTag, TemplateVariable } from "./vendors/types.js";

// ── Manifest schema ──

export const MANIFEST_VERSION = 1;

export interface ManifestTag {
  name: string;
  type: string;
  html?: string;
  config?: Record<string, unknown>;
  triggerEvent: string;
  consentType?: string;
  note?: string;
  installMode?: string;
}

export interface ManifestVariable {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface TemplateManifest {
  /** Schema version for forward compatibility */
  version: number;
  /** TagOps template ID that generated this manifest */
  templateId: string;
  /** Human-readable template name */
  templateName: string;
  /** Semver of the template definition at export time (may be undefined for unversioned templates) */
  templateVersion?: string;
  /** Vendor name (Google, Meta, TikTok, etc.) */
  vendor: string;
  /** Template category */
  category: string;
  /** Description of what this manifest installs */
  description: string;
  /** The inputs used to hydrate the template */
  inputs: Record<string, string>;
  /** ISO timestamp of when this manifest was generated */
  generatedAt: string;
  /** TagOps version that generated this manifest */
  generatorVersion: string;
  /** Hydrated tags to install */
  tags: ManifestTag[];
  /** Variables to create */
  variables: ManifestVariable[];
}

// ── Export ──

function getTagOpsVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf-8"));
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function validateExportInputs(template: IntegrationTemplate, inputs: Record<string, string>): void {
  for (const required of template.requiredInputs) {
    if (!inputs[required.key]) {
      const flagName = required.key.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
      throw new Error(
        `Missing required input: --${flagName} (${required.name})\n  Example: ${required.example}`,
      );
    }
  }
}

export function exportTemplate(
  templateId: string,
  inputs: Record<string, string>,
): TemplateManifest {
  const template = extractedVendorTemplates.find((t) => t.id === templateId);
  if (!template) {
    const available = extractedVendorTemplates.map((t) => t.id).join(", ");
    throw new Error(`Template "${templateId}" not found. Available: ${available}`);
  }

  validateExportInputs(template, inputs);

  const tags: ManifestTag[] = template.tags(inputs).map((tag: TemplateTag) => ({
    name: tag.name,
    type: tag.type,
    ...(tag.html ? { html: tag.html } : {}),
    ...(tag.config ? { config: tag.config } : {}),
    triggerEvent: tag.triggerEvent,
    ...(tag.consentType ? { consentType: tag.consentType } : {}),
    ...(tag.note ? { note: tag.note } : {}),
    ...(tag.installMode ? { installMode: tag.installMode } : {}),
  }));

  const variables: ManifestVariable[] = (template.variables ?? []).map((v: TemplateVariable) => ({
    name: v.name,
    type: v.type,
    config: v.config,
  }));

  return {
    version: MANIFEST_VERSION,
    templateId: template.id,
    templateName: template.name,
    ...(template.version ? { templateVersion: template.version } : {}),
    vendor: template.vendor,
    category: template.category,
    description: template.description,
    inputs,
    generatedAt: new Date().toISOString(),
    generatorVersion: getTagOpsVersion(),
    tags,
    variables,
  };
}

// ── Import (validation + parsing) ──

export interface ManifestValidationError {
  field: string;
  message: string;
}

export interface ManifestValidationResult {
  valid: boolean;
  errors: ManifestValidationError[];
  manifest?: TemplateManifest;
}

function validateManifestStructure(data: unknown): ManifestValidationResult {
  const errors: ManifestValidationError[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return { valid: false, errors: [{ field: "root", message: "Manifest must be a JSON object" }] };
  }

  const obj = data as Record<string, unknown>;

  // Required fields
  if (typeof obj.version !== "number") {
    errors.push({ field: "version", message: "Missing or invalid 'version' (must be a number)" });
  } else if (obj.version > MANIFEST_VERSION) {
    errors.push({
      field: "version",
      message: `Manifest version ${obj.version} is newer than supported (${MANIFEST_VERSION}). Update TagOps.`,
    });
  }

  if (typeof obj.templateId !== "string" || !obj.templateId) {
    errors.push({ field: "templateId", message: "Missing or invalid 'templateId'" });
  }

  if (typeof obj.templateName !== "string" || !obj.templateName) {
    errors.push({ field: "templateName", message: "Missing or invalid 'templateName'" });
  }

  if (!Array.isArray(obj.tags)) {
    errors.push({ field: "tags", message: "Missing or invalid 'tags' array" });
  } else {
    for (let i = 0; i < obj.tags.length; i++) {
      const tag = obj.tags[i];
      if (!tag || typeof tag !== "object") {
        errors.push({ field: `tags[${i}]`, message: "Tag must be an object" });
        continue;
      }
      if (typeof tag.name !== "string") {
        errors.push({ field: `tags[${i}].name`, message: "Tag name must be a string" });
      }
      if (typeof tag.type !== "string") {
        errors.push({ field: `tags[${i}].type`, message: "Tag type must be a string" });
      }
      if (typeof tag.triggerEvent !== "string") {
        errors.push({
          field: `tags[${i}].triggerEvent`,
          message: "Tag triggerEvent must be a string",
        });
      }
    }
  }

  if (obj.variables !== undefined && !Array.isArray(obj.variables)) {
    errors.push({ field: "variables", message: "'variables' must be an array if present" });
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], manifest: obj as unknown as TemplateManifest };
}

export function loadManifest(filePath: string): ManifestValidationResult {
  if (!existsSync(filePath)) {
    return {
      valid: false,
      errors: [{ field: "file", message: `File not found: ${filePath}` }],
    };
  }

  let data: unknown;
  try {
    data = JSON.parse(readFileSync(filePath, "utf-8"));
  } catch (err) {
    return {
      valid: false,
      errors: [{ field: "file", message: `Invalid JSON: ${(err as Error).message}` }],
    };
  }

  return validateManifestStructure(data);
}

// ── Print helpers ──

export function printManifestSummary(manifest: TemplateManifest): void {
  console.log(chalk.bold("\n  Template Manifest\n"));
  const versionSuffix = manifest.templateVersion ? chalk.gray(` v${manifest.templateVersion}`) : "";
  console.log(
    `  Template:     ${chalk.cyan(manifest.templateName)} (${manifest.templateId})${versionSuffix}`,
  );
  console.log(`  Vendor:       ${manifest.vendor}`);
  console.log(`  Category:     ${manifest.category}`);
  console.log(`  Description:  ${manifest.description}`);
  console.log(`  Generated:    ${manifest.generatedAt}`);
  console.log(`  Generator:    TagOps v${manifest.generatorVersion}`);

  if (Object.keys(manifest.inputs).length > 0) {
    console.log(chalk.bold("\n  Inputs:"));
    for (const [key, value] of Object.entries(manifest.inputs)) {
      console.log(`    ${key}: ${chalk.cyan(value)}`);
    }
  }

  console.log(chalk.bold(`\n  Tags (${manifest.tags.length}):`));
  for (const tag of manifest.tags) {
    const consent = tag.consentType ? chalk.dim(` [${tag.consentType}]`) : "";
    console.log(`    ${chalk.green("○")} ${tag.name} → ${tag.triggerEvent}${consent}`);
  }

  if (manifest.variables.length > 0) {
    console.log(chalk.bold(`\n  Variables (${manifest.variables.length}):`));
    for (const v of manifest.variables) {
      console.log(`    ${chalk.green("○")} ${v.name} (${v.type})`);
    }
  }

  console.log();
}

export function printManifestValidationErrors(result: ManifestValidationResult): void {
  console.log(chalk.bold("\n  Manifest Validation Failed\n"));
  for (const error of result.errors) {
    console.log(`  ${chalk.red("✖")} [${chalk.cyan(error.field)}] ${error.message}`);
  }
  console.log();
}
