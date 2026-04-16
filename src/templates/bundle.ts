/**
 * Template Bundles — Multi-template manifests for agency bulk installs
 *
 * A bundle groups multiple template manifests into a single file.
 * Agencies export their standard tracking stack once, then import it
 * across all client containers.
 *
 * Usage:
 *   tagops templates bundle create --name "standard-ecom" \
 *     --template meta-pixel --pixel-id 123 \
 *     --template ga4-ecommerce --measurement-id G-ABC \
 *     --output standard-ecom.bundle.json
 *
 *   tagops templates bundle install standard-ecom.bundle.json --dry-run
 */

import { readFileSync, existsSync } from "node:fs";
import chalk from "chalk";
import { exportTemplate, MANIFEST_VERSION, type TemplateManifest } from "./manifest.js";

// ── Bundle schema ──

export interface TemplateBundle {
  /** Schema version */
  version: number;
  /** Bundle name (e.g. "agency-standard-ecom") */
  name: string;
  /** Human-readable description */
  description: string;
  /** ISO timestamp */
  createdAt: string;
  /** Individual template manifests */
  templates: TemplateManifest[];
}

// ── Create a bundle ──

export interface BundleTemplateEntry {
  templateId: string;
  inputs: Record<string, string>;
}

export interface CreateBundleOptions {
  name: string;
  description?: string;
  entries: BundleTemplateEntry[];
}

export function createBundle(options: CreateBundleOptions): TemplateBundle {
  if (!options.name) {
    throw new Error("Bundle name is required");
  }

  if (options.entries.length === 0) {
    throw new Error("Bundle must contain at least one template");
  }

  const templates: TemplateManifest[] = [];

  for (const entry of options.entries) {
    const manifest = exportTemplate(entry.templateId, entry.inputs);
    templates.push(manifest);
  }

  return {
    version: MANIFEST_VERSION,
    name: options.name,
    description: options.description ?? `TagOps bundle with ${templates.length} templates`,
    createdAt: new Date().toISOString(),
    templates,
  };
}

// ── Load and validate a bundle ──

export interface BundleValidationError {
  field: string;
  message: string;
}

export interface BundleValidationResult {
  valid: boolean;
  errors: BundleValidationError[];
  bundle?: TemplateBundle;
}

export function loadBundle(filePath: string): BundleValidationResult {
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

  return validateBundleStructure(data);
}

function validateBundleStructure(data: unknown): BundleValidationResult {
  const errors: BundleValidationError[] = [];

  if (!data || typeof data !== "object" || Array.isArray(data)) {
    return {
      valid: false,
      errors: [{ field: "root", message: "Bundle must be a JSON object" }],
    };
  }

  const obj = data as Record<string, unknown>;

  if (typeof obj.version !== "number") {
    errors.push({ field: "version", message: "Missing or invalid 'version'" });
  } else if (obj.version > MANIFEST_VERSION) {
    errors.push({
      field: "version",
      message: `Bundle version ${obj.version} is newer than supported (${MANIFEST_VERSION}). Update TagOps.`,
    });
  }

  if (typeof obj.name !== "string" || !obj.name) {
    errors.push({ field: "name", message: "Missing or invalid 'name'" });
  }

  if (!Array.isArray(obj.templates)) {
    errors.push({ field: "templates", message: "Missing or invalid 'templates' array" });
  } else if (obj.templates.length === 0) {
    errors.push({ field: "templates", message: "Bundle must contain at least one template" });
  } else {
    for (let i = 0; i < obj.templates.length; i++) {
      const t = obj.templates[i];
      if (!t || typeof t !== "object") {
        errors.push({ field: `templates[${i}]`, message: "Template must be an object" });
        continue;
      }
      if (typeof t.templateId !== "string") {
        errors.push({
          field: `templates[${i}].templateId`,
          message: "Template templateId must be a string",
        });
      }
      if (!Array.isArray(t.tags)) {
        errors.push({
          field: `templates[${i}].tags`,
          message: "Template tags must be an array",
        });
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return { valid: true, errors: [], bundle: obj as unknown as TemplateBundle };
}

// ── Print helpers ──

export function printBundleSummary(bundle: TemplateBundle): void {
  console.log(chalk.bold("\n  Template Bundle\n"));
  console.log(`  Name:         ${chalk.cyan(bundle.name)}`);
  console.log(`  Description:  ${bundle.description}`);
  console.log(`  Created:      ${bundle.createdAt}`);
  console.log(`  Templates:    ${bundle.templates.length}`);

  const totalTags = bundle.templates.reduce((sum, t) => sum + t.tags.length, 0);
  const totalVars = bundle.templates.reduce((sum, t) => sum + t.variables.length, 0);
  console.log(`  Total tags:   ${totalTags}`);
  if (totalVars > 0) {
    console.log(`  Total vars:   ${totalVars}`);
  }

  console.log(chalk.bold("\n  Contents:\n"));
  for (const template of bundle.templates) {
    console.log(
      `  ${chalk.green("○")} ${chalk.cyan(template.templateId)} — ${template.templateName} (${template.tags.length} tags)`,
    );
    for (const [key, value] of Object.entries(template.inputs)) {
      console.log(`      ${chalk.dim(`${key}: ${value}`)}`);
    }
  }
  console.log();
}

export function printBundleValidationErrors(result: BundleValidationResult): void {
  console.log(chalk.bold("\n  Bundle Validation Failed\n"));
  for (const error of result.errors) {
    console.log(`  ${chalk.red("✖")} [${chalk.cyan(error.field)}] ${error.message}`);
  }
  console.log();
}
