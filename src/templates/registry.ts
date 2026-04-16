/**
 * Integration Template Registry
 *
 * Pre-built, tested GTM configurations for common platforms.
 * Each template declares the tags, triggers, and variables needed
 * to integrate a platform with a standard e-commerce dataLayer.
 *
 * Usage:
 *   npx tsx src/cli.ts templates list
 *   npx tsx src/cli.ts templates install meta-pixel --pixel-id 123456
 */

import chalk from "chalk";
import { createTag, createTrigger, createVariable, buildHtmlTagConfig } from "../lib/gtm-cli.js";
import {
  ALL_PAGES_TRIGGER_ID,
  CONSENT_INITIALIZATION_TRIGGER_ID,
  INITIALIZATION_TRIGGER_ID,
  TRIGGER_MAP,
  discoverTriggerByEvent,
} from "../lib/architecture.js";
import { requireWriteAccess } from "../lib/permission-guard.js";
import type { GtmParameter } from "../types/gtm.js";
import { extractedVendorTemplates } from "./vendors/index.js";

// ── Template types ──

type TemplateTriggerEvent =
  | keyof typeof TRIGGER_MAP
  | "all_pages"
  | "initialization"
  | "consent_initialization";

type TemplateInstallMode = "create" | "unsupported" | "instruction_only";

type TemplateInputValidator = "pixelId" | "measurementId" | "conversionId";

export interface TemplateInput {
  key: string;
  name: string;
  description: string;
  example: string;
  validator?: TemplateInputValidator;
}

export interface TemplateTag {
  name: string;
  type: string;
  html?: string;
  config?: Record<string, unknown>;
  triggerEvent: TemplateTriggerEvent;
  consentType?: string;
  note?: string;
  installMode?: TemplateInstallMode;
}

export interface TemplateVariable {
  name: string;
  type: string;
  config: Record<string, unknown>;
}

export interface IntegrationTemplate {
  id: string;
  name: string;
  description: string;
  version?: string;
  vendor: string;
  category:
    | "analytics"
    | "advertising"
    | "marketing"
    | "social"
    | "attribution"
    | "retargeting"
    | "platform"
    | "affiliate";
  requiredInputs: TemplateInput[];
  tags: (inputs: Record<string, string>) => TemplateTag[];
  variables?: TemplateVariable[];
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  version?: string;
  vendor: string;
  category: string;
  requiredInputs: TemplateInput[];
}

export interface InstallAction {
  type: "tag" | "trigger" | "variable";
  name: string;
  action: "created" | "dry_run" | "failed" | "unsupported" | "skipped";
  detail?: string;
}

export interface InstallResult {
  templateId: string;
  templateName: string;
  templateVersion?: string;
  dryRun: boolean;
  actions: InstallAction[];
  summary: { tags: number; triggers: number; variables: number; failed: number };
}

export interface InstallOptions {
  dryRun: boolean;
  pixelId?: string;
  measurementId?: string;
  conversionId?: string;
}

function getTriggerDisplayName(triggerEvent: string): string {
  if (triggerEvent === "all_pages") {
    return "All Pages";
  }
  if (triggerEvent === "initialization") {
    return "Initialization";
  }
  if (triggerEvent === "consent_initialization") {
    return "Consent Initialization";
  }

  return TRIGGER_MAP[triggerEvent as keyof typeof TRIGGER_MAP]?.name ?? triggerEvent;
}

function jsStringLiteral(value: string): string {
  return JSON.stringify(value);
}

function buildConsentSettings(consentType?: string): Record<string, unknown> | undefined {
  if (!consentType) {
    return undefined;
  }

  return {
    consentSettings: {
      consentStatus: "needed",
      consentType: {
        type: "list",
        list: [{ type: "template", value: consentType }],
      },
    },
  };
}

function buildTemplateTagConfig(
  parameter: GtmParameter[],
  consentType?: string,
  extras: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    parameter,
    ...extras,
    ...(buildConsentSettings(consentType) ?? {}),
  };
}

function buildCustomEventTriggerConfig(
  triggerEvent: keyof typeof TRIGGER_MAP,
): Record<string, unknown> {
  return {
    customEventFilter: [
      {
        type: "EQUALS",
        parameter: [
          { type: "TEMPLATE", key: "arg0", value: "{{_event}}" },
          { type: "TEMPLATE", key: "arg1", value: TRIGGER_MAP[triggerEvent].event },
        ],
      },
    ],
  };
}

function getRequiredInputValue(
  input: TemplateInput,
  options: { pixelId?: string; measurementId?: string; conversionId?: string },
): string | undefined {
  if (input.key === "measurementId") {
    return options.measurementId;
  }
  if (input.key === "conversionId") {
    if (options.conversionId) {
      return options.conversionId;
    }
    return options.pixelId && /^AW-[0-9]+$/i.test(options.pixelId) ? options.pixelId : undefined;
  }
  return options.pixelId;
}

function validateTemplateInput(input: TemplateInput, value: string): void {
  if (!value) {
    return;
  }

  const validator =
    input.validator ??
    (input.key === "measurementId"
      ? "measurementId"
      : input.key === "conversionId"
        ? "conversionId"
        : input.key === "pixelId"
          ? "pixelId"
          : undefined);

  if (validator === "measurementId" && !/^G-[A-Z0-9]+$/i.test(value)) {
    throw new Error(`${input.name} must look like G-XXXXXXXXXX.`);
  }

  if (validator === "conversionId" && !/^AW-[0-9]+$/i.test(value)) {
    throw new Error(`${input.name} must look like AW-1234567890.`);
  }

  if (validator === "pixelId" && !/^[A-Za-z0-9][A-Za-z0-9_-]*$/.test(value)) {
    throw new Error(`${input.name} must be alphanumeric and may include hyphens or underscores.`);
  }
}

function isBootstrapTagName(name: string): boolean {
  const lowerName = name.toLowerCase();
  return ["base", "bootstrap", "config", "global site", "loader", "linker", "initialization"].some(
    (pattern) => lowerName.includes(pattern),
  );
}

function getRecommendedTagFiringOption(tag: TemplateTag): "oncePerEvent" | "oncePerLoad" {
  const loadScoped =
    tag.triggerEvent === "all_pages" ||
    tag.triggerEvent === "initialization" ||
    tag.triggerEvent === "consent_initialization";

  return loadScoped && isBootstrapTagName(tag.name) ? "oncePerLoad" : "oncePerEvent";
}

async function resolveTriggerId(
  tag: TemplateTag,
  actions: InstallAction[],
): Promise<{ triggerId: string | null; triggerCreated: boolean }> {
  if (tag.triggerEvent === "all_pages") {
    return { triggerId: ALL_PAGES_TRIGGER_ID, triggerCreated: false };
  }

  if (tag.triggerEvent === "initialization") {
    return { triggerId: INITIALIZATION_TRIGGER_ID, triggerCreated: false };
  }

  if (tag.triggerEvent === "consent_initialization") {
    return { triggerId: CONSENT_INITIALIZATION_TRIGGER_ID, triggerCreated: false };
  }

  const existingTriggerId = await discoverTriggerByEvent(tag.triggerEvent);
  if (existingTriggerId) {
    return { triggerId: existingTriggerId, triggerCreated: false };
  }

  const trigger = await createTrigger(
    TRIGGER_MAP[tag.triggerEvent].name,
    "CUSTOM_EVENT",
    buildCustomEventTriggerConfig(tag.triggerEvent),
  );

  if (trigger) {
    actions.push({ type: "trigger", name: trigger.name, action: "created" });
    return { triggerId: trigger.triggerId, triggerCreated: true };
  }

  return { triggerId: null, triggerCreated: false };
}

// ── Template definitions ──
// Each template is lazy-loaded to keep this registry file lean.

function getTemplates(): IntegrationTemplate[] {
  return [...extractedVendorTemplates];
}
function normalizeLookupValue(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function scoreTemplateLookup(template: IntegrationTemplate, lookup: string): number {
  const normalizedLookup = normalizeLookupValue(lookup);
  if (!normalizedLookup) {
    return 0;
  }

  let bestScore = 0;
  for (const candidate of [template.id, template.name, template.vendor, template.description]) {
    const normalizedCandidate = normalizeLookupValue(candidate);
    if (!normalizedCandidate) {
      continue;
    }

    if (normalizedCandidate === normalizedLookup) {
      bestScore = Math.max(bestScore, 100);
      continue;
    }

    if (
      normalizedCandidate.startsWith(normalizedLookup) ||
      normalizedLookup.startsWith(normalizedCandidate)
    ) {
      bestScore = Math.max(bestScore, 90);
      continue;
    }

    if (
      normalizedCandidate.includes(normalizedLookup) ||
      normalizedLookup.includes(normalizedCandidate)
    ) {
      bestScore = Math.max(bestScore, 80);
    }
  }

  return bestScore;
}

// ── Public API ──

export function listTemplates(): TemplateInfo[] {
  return getTemplates().map((t) => ({
    id: t.id,
    name: t.name,
    description: t.description,
    version: t.version,
    vendor: t.vendor,
    category: t.category,
    requiredInputs: t.requiredInputs,
  }));
}

export function findTemplateIdByVendor(vendorName: string): string | null {
  let bestTemplate: IntegrationTemplate | null = null;
  let bestScore = 0;

  for (const template of getTemplates()) {
    const score = scoreTemplateLookup(template, vendorName);
    if (score > bestScore) {
      bestTemplate = template;
      bestScore = score;
    }
  }

  return bestTemplate?.id ?? null;
}

export function printTemplateList(templates: TemplateInfo[]): void {
  console.log(chalk.bold("\n  Available Integration Templates\n"));

  const categories = [...new Set(templates.map((t) => t.category))];
  for (const cat of categories) {
    console.log(chalk.underline(`  ${cat.charAt(0).toUpperCase() + cat.slice(1)}`));
    const catTemplates = templates.filter((t) => t.category === cat);
    for (const t of catTemplates) {
      const versionTag = t.version ? chalk.gray(` v${t.version}`) : "";
      console.log(`    ${chalk.cyan(t.id.padEnd(20))} ${t.name}${versionTag}`);
      console.log(`    ${"".padEnd(20)} ${chalk.gray(t.description)}`);
    }
    console.log();
  }

  console.log(
    `  Install with: ${chalk.cyan("tagops templates install <id> --pixel-id <your-id>")}\n`,
  );
}

export async function installTemplate(
  templateId: string,
  options: InstallOptions,
): Promise<InstallResult> {
  if (!options.dryRun) {
    await requireWriteAccess();
  }

  const templates = getTemplates();
  const template = templates.find((t) => t.id === templateId);

  if (!template) {
    const available = templates.map((t) => t.id).join(", ");
    throw new Error(`Template "${templateId}" not found. Available: ${available}`);
  }

  // Validate required inputs
  const inputs: Record<string, string> = {};
  for (const input of template.requiredInputs) {
    const value = getRequiredInputValue(input, options);
    if (!value && !options.dryRun) {
      const flagName = input.key.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);
      throw new Error(
        `Missing required input: --${flagName} (${input.name})\n  Example: ${input.example}`,
      );
    }

    const resolvedValue = value ?? input.example;
    validateTemplateInput(input, resolvedValue);
    inputs[input.key] = resolvedValue;
  }

  const actions: InstallAction[] = [];
  let tagCount = 0;
  let triggerCount = 0;
  let variableCount = 0;
  let failedCount = 0;

  // Install variables first
  if (template.variables) {
    for (const variable of template.variables) {
      if (options.dryRun) {
        actions.push({ type: "variable", name: variable.name, action: "dry_run" });
        variableCount++;
      } else {
        const result = await createVariable(variable.name, variable.type, variable.config);
        if (result) {
          actions.push({ type: "variable", name: variable.name, action: "created" });
          variableCount++;
        } else {
          actions.push({ type: "variable", name: variable.name, action: "failed" });
          failedCount++;
        }
      }
    }
  }

  // Install tags
  const templateTags = template.tags(inputs);
  for (const tag of templateTags) {
    const triggerName = getTriggerDisplayName(tag.triggerEvent);
    const detailParts = [`trigger: ${triggerName}`];
    if (tag.note) {
      detailParts.push(tag.note);
    }

    tagCount++;

    if (options.dryRun) {
      actions.push({
        type: "tag",
        name: tag.name,
        action: "dry_run",
        detail: detailParts.join(" | "),
      });
      continue;
    }

    if (tag.installMode === "instruction_only") {
      actions.push({
        type: "tag",
        name: tag.name,
        action: "unsupported",
        detail: tag.note ?? "Instruction-only template",
      });
      failedCount++;
      continue;
    }

    const { triggerId, triggerCreated } = await resolveTriggerId(tag, actions);
    if (triggerCreated) {
      triggerCount++;
    }

    if (!triggerId) {
      actions.push({
        type: "tag",
        name: tag.name,
        action: "failed",
        detail: `missing trigger: ${triggerName}`,
      });
      failedCount++;
      continue;
    }

    const config =
      tag.type === "html" ? buildHtmlTagConfig(tag.html ?? "", tag.consentType) : tag.config;
    if (!config) {
      actions.push({
        type: "tag",
        name: tag.name,
        action: "failed",
        detail: `missing config for tag type '${tag.type}'`,
      });
      failedCount++;
      continue;
    }

    if (!("tagFiringOption" in config)) {
      (config as Record<string, unknown>).tagFiringOption = getRecommendedTagFiringOption(tag);
    }

    const result = await createTag({
      name: tag.name,
      type: tag.type,
      firingTriggerId: triggerId,
      config,
    });

    if (result?.created) {
      actions.push({ type: "tag", name: tag.name, action: "created" });
    } else if (result?.duplicate) {
      actions.push({
        type: "tag",
        name: tag.name,
        action: "skipped",
        detail: "duplicate tag name",
      });
    } else {
      actions.push({
        type: "tag",
        name: tag.name,
        action: "failed",
        detail: result?.rawResponse ?? detailParts.join(" | "),
      });
      failedCount++;
    }
  }

  return {
    templateId,
    templateName: template.name,
    templateVersion: template.version,
    dryRun: options.dryRun,
    actions,
    summary: {
      tags: tagCount,
      triggers: triggerCount,
      variables: variableCount,
      failed: failedCount,
    },
  };
}

export function printInstallResult(result: InstallResult): void {
  const prefix = result.dryRun ? chalk.cyan("[DRY RUN] ") : "";
  const versionSuffix = result.templateVersion ? chalk.gray(` (v${result.templateVersion})`) : "";
  console.log(chalk.bold(`\n  ${prefix}Installing: ${result.templateName}${versionSuffix}\n`));

  for (const action of result.actions) {
    const icon =
      action.action === "created"
        ? chalk.green("✔")
        : action.action === "unsupported" || action.action === "skipped"
          ? chalk.yellow("!")
          : action.action === "dry_run"
            ? chalk.cyan("○")
            : chalk.red("✖");
    const detail = action.detail ? chalk.gray(` (${action.detail})`) : "";
    console.log(`  ${icon} [${action.type}] ${action.name}${detail}`);
  }

  const s = result.summary;
  console.log(chalk.bold("\n  Summary"));
  console.log(`    Tags:      ${s.tags}`);
  console.log(`    Triggers:  ${s.triggers}`);
  console.log(`    Variables: ${s.variables}`);
  if (s.failed > 0) console.log(chalk.red(`    Failed:    ${s.failed}`));
  console.log();
}

// ═══════════════════════════════════════════════════════════
// PREVIEW — show full HTML/config before install
// ═══════════════════════════════════════════════════════════

export interface PreviewResult {
  templateId: string;
  templateName: string;
  templateVersion?: string;
  description: string;
  category: string;
  vendor: string;
  requiredInputs: IntegrationTemplate["requiredInputs"];
  tags: Array<{
    name: string;
    type: string;
    triggerEvent: string;
    consentType?: string;
    html: string;
    config?: Record<string, unknown>;
    note?: string;
  }>;
  variables: TemplateVariable[];
}

export function previewTemplate(
  templateId: string,
  options: { pixelId?: string; measurementId?: string; conversionId?: string } = {},
): PreviewResult {
  const template = getTemplates().find((t) => t.id === templateId);
  if (!template) {
    throw new Error(
      `Template '${templateId}' not found. Run 'tagops templates list' to see available templates.`,
    );
  }

  const inputs: Record<string, string> = {};
  if (options.pixelId) inputs.pixelId = options.pixelId;
  if (options.measurementId) inputs.measurementId = options.measurementId;
  if (options.conversionId) inputs.conversionId = options.conversionId;

  // Use example values for any missing required inputs
  for (const req of template.requiredInputs) {
    if (!inputs[req.key]) {
      const resolvedValue = getRequiredInputValue(req, options) ?? req.example;
      validateTemplateInput(req, resolvedValue);
      inputs[req.key] = resolvedValue;
    }
  }

  const tags = template.tags(inputs);

  return {
    templateId: template.id,
    templateName: template.name,
    templateVersion: template.version,
    description: template.description,
    category: template.category,
    vendor: template.vendor,
    requiredInputs: template.requiredInputs,
    tags: tags.map((t) => ({
      name: t.name,
      type: t.type,
      triggerEvent: t.triggerEvent,
      consentType: t.consentType,
      html: t.html ?? "",
      config: t.config,
      note: t.note,
    })),
    variables: template.variables ?? [],
  };
}

export function printPreviewResult(result: PreviewResult): void {
  const versionSuffix = result.templateVersion ? chalk.gray(` (v${result.templateVersion})`) : "";
  console.log(chalk.bold(`\n  Template Preview: ${result.templateName}${versionSuffix}\n`));
  console.log(`  ${chalk.gray("Vendor:")}     ${result.vendor}`);
  console.log(`  ${chalk.gray("Category:")}   ${result.category}`);
  console.log(`  ${chalk.gray("ID:")}         ${result.templateId}`);
  if (result.templateVersion) {
    console.log(`  ${chalk.gray("Version:")}    ${result.templateVersion}`);
  }
  console.log(`  ${chalk.gray("Description:")} ${result.description}`);
  console.log();

  // Required inputs
  console.log(chalk.bold("  Required Inputs:"));
  for (const input of result.requiredInputs) {
    console.log(`    ${chalk.cyan(input.key)}: ${input.name}`);
    console.log(`      ${chalk.gray(input.description)}`);
    console.log(`      ${chalk.gray(`Example: ${input.example}`)}`);
  }
  console.log();

  // Tags with full HTML
  console.log(chalk.bold(`  Tags (${result.tags.length}):\n`));
  for (let i = 0; i < result.tags.length; i++) {
    const tag = result.tags[i];
    console.log(chalk.bold.cyan(`  ── ${i + 1}. ${tag.name} ──`));
    console.log(`  ${chalk.gray("Type:")}    ${tag.type}`);
    console.log(`  ${chalk.gray("Trigger:")} ${tag.triggerEvent}`);
    if (tag.consentType) {
      console.log(`  ${chalk.gray("Consent:")} ${tag.consentType}`);
    }
    if (tag.note) {
      console.log(`  ${chalk.gray("Note:")}    ${tag.note}`);
    }
    if (tag.html) {
      console.log(chalk.gray("  ─── HTML ───────────────────────────────────"));
      // Indent and dim the HTML
      const lines = tag.html.split("\\n").join("\n").split("\n");
      for (const line of lines) {
        console.log(`  ${chalk.dim(line)}`);
      }
      console.log(chalk.gray("  ─────────────────────────────────────────────"));
    } else if (tag.config) {
      console.log(chalk.gray("  ─── CONFIG ─────────────────────────────────"));
      for (const line of JSON.stringify(tag.config, null, 2).split("\n")) {
        console.log(`  ${chalk.dim(line)}`);
      }
      console.log(chalk.gray("  ─────────────────────────────────────────────"));
    }
    console.log();
  }

  if (result.variables.length > 0) {
    console.log(chalk.bold(`  Variables (${result.variables.length}):\n`));
    for (const v of result.variables) {
      console.log(`    ${chalk.cyan(v.name)} (${v.type})`);
    }
    console.log();
  }
}

// ═══════════════════════════════════════════════════════════
// VALIDATE — check installed tags match template definitions
// ═══════════════════════════════════════════════════════════

export interface ValidationIssue {
  tagName: string;
  type: "missing" | "html_mismatch" | "consent_mismatch" | "trigger_mismatch" | "extra_tag";
  expected?: string;
  actual?: string;
  detail?: string;
  recommendation?: string;
}

export interface ValidationResult {
  templateId: string;
  templateName: string;
  status: "pass" | "warn" | "fail";
  issues: ValidationIssue[];
  matched: number;
  total: number;
}

export function validateInstalledTags(
  templateId: string,
  installedTags: Array<{
    name: string;
    type: string;
    html?: string;
    consentType?: string;
    triggerEvent?: string | string[];
  }>,
  options: { pixelId?: string; measurementId?: string; conversionId?: string } = {},
): ValidationResult {
  const template = getTemplates().find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Template '${templateId}' not found.`);
  }

  const inputs: Record<string, string> = {};
  if (options.pixelId) inputs.pixelId = options.pixelId;
  if (options.measurementId) inputs.measurementId = options.measurementId;
  if (options.conversionId) inputs.conversionId = options.conversionId;
  for (const req of template.requiredInputs) {
    if (!inputs[req.key]) {
      const resolvedValue = getRequiredInputValue(req, options) ?? req.example;
      validateTemplateInput(req, resolvedValue);
      inputs[req.key] = resolvedValue;
    }
  }

  const expectedTags = template.tags(inputs);
  const issues: ValidationIssue[] = [];
  const matchedInstalledIndexes = new Set<number>();
  let matched = 0;

  const normalizeHtml = (html?: string): string =>
    (html ?? "").replace(/\r\n/g, "\n").replace(/\s+/g, " ").trim();

  const summarizeHtml = (html?: string): string => {
    const normalized = normalizeHtml(html);
    if (!normalized) {
      return "none";
    }
    return normalized.length > 140 ? `${normalized.slice(0, 137)}...` : normalized;
  };

  const normalizeTagName = (name: string): string =>
    name
      .toLowerCase()
      .replace(/[–—]/g, "-")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const normalizeTriggerEvents = (triggerEvent?: string | string[]): string[] => {
    const events = Array.isArray(triggerEvent) ? triggerEvent : triggerEvent ? [triggerEvent] : [];
    return [...new Set(events.filter(Boolean))];
  };

  const formatTriggerEvents = (triggerEvent?: string | string[]): string => {
    const events = normalizeTriggerEvents(triggerEvent);
    if (events.length === 0) {
      return "none";
    }

    return events.map((event) => getTriggerDisplayName(event)).join(", ");
  };

  const findInstalledTagIndex = (expectedName: string): number => {
    const normalizedExpected = normalizeTagName(expectedName);

    return installedTags.findIndex((tag, index) => {
      if (matchedInstalledIndexes.has(index)) {
        return false;
      }

      const normalizedInstalled = normalizeTagName(tag.name);
      return (
        normalizedInstalled === normalizedExpected ||
        normalizedInstalled.includes(normalizedExpected) ||
        normalizedExpected.includes(normalizedInstalled)
      );
    });
  };

  for (const expected of expectedTags) {
    const installedIndex = findInstalledTagIndex(expected.name);
    const installed = installedIndex >= 0 ? installedTags[installedIndex] : undefined;

    if (!installed) {
      issues.push({
        tagName: expected.name,
        type: "missing",
        expected: `Install ${expected.name} on ${getTriggerDisplayName(expected.triggerEvent)}`,
        actual: "Not found",
        detail: `${expected.name} is defined by the ${template.name} template but is missing from the container.`,
        recommendation: `Reinstall the template or recreate this tag on ${getTriggerDisplayName(expected.triggerEvent)}.`,
      });
      continue;
    }

    matchedInstalledIndexes.add(installedIndex);
    let tagMatchesTemplate = true;

    if (expected.type === "html" && installed.html !== undefined && normalizeHtml(expected.html)) {
      const expectedHtml = normalizeHtml(expected.html);
      const actualHtml = normalizeHtml(installed.html);
      if (expectedHtml !== actualHtml) {
        tagMatchesTemplate = false;
        issues.push({
          tagName: expected.name,
          type: "html_mismatch",
          expected: summarizeHtml(expected.html),
          actual: summarizeHtml(installed.html),
          detail: `${expected.name} exists, but its Custom HTML no longer matches the template definition.`,
          recommendation:
            "Replace the installed HTML with the template HTML or reinstall the template.",
        });
      }
    }

    // Check consent
    if (expected.consentType && installed.consentType !== expected.consentType) {
      tagMatchesTemplate = false;
      issues.push({
        tagName: expected.name,
        type: "consent_mismatch",
        expected: expected.consentType,
        actual: installed.consentType ?? "none",
        detail: `${expected.name} should require ${expected.consentType}, but the installed tag is configured for ${installed.consentType ?? "no consent type"}.`,
        recommendation: `Update the tag consent settings to require ${expected.consentType}.`,
      });
    }

    if (installed.triggerEvent !== undefined) {
      const expectedTriggerEvents = normalizeTriggerEvents(expected.triggerEvent);
      const actualTriggerEvents = normalizeTriggerEvents(installed.triggerEvent);
      const triggersMatch =
        expectedTriggerEvents.length === actualTriggerEvents.length &&
        expectedTriggerEvents.every((event) => actualTriggerEvents.includes(event));

      if (!triggersMatch) {
        tagMatchesTemplate = false;
        issues.push({
          tagName: expected.name,
          type: "trigger_mismatch",
          expected: formatTriggerEvents(expected.triggerEvent),
          actual: formatTriggerEvents(installed.triggerEvent),
          detail: `${expected.name} should fire on ${getTriggerDisplayName(expected.triggerEvent)}, but the installed firing trigger is ${formatTriggerEvents(installed.triggerEvent)}.`,
          recommendation: `Attach the tag to ${getTriggerDisplayName(expected.triggerEvent)} and remove incorrect triggers.`,
        });
      }
    }

    if (tagMatchesTemplate) {
      matched++;
    }
  }

  for (const [index, installed] of installedTags.entries()) {
    if (matchedInstalledIndexes.has(index)) {
      continue;
    }

    const vendorLower = template.vendor.toLowerCase();
    if (installed.name.toLowerCase().includes(vendorLower)) {
      issues.push({
        tagName: installed.name,
        type: "extra_tag",
        expected: "Not in template",
        actual: "Found in container",
        detail: `${installed.name} looks like a ${template.vendor} tag, but it is not part of the ${template.name} template.`,
        recommendation: `Remove, pause, or rename ${installed.name} if it is a legacy tag.`,
      });
    }
  }

  const status =
    issues.length === 0
      ? "pass"
      : issues.some(
            (i) =>
              i.type === "missing" || i.type === "html_mismatch" || i.type === "trigger_mismatch",
          )
        ? "fail"
        : "warn";

  return {
    templateId,
    templateName: template.name,
    status,
    issues,
    matched,
    total: expectedTags.length,
  };
}

export function printValidationResult(result: ValidationResult): void {
  const statusIcon =
    result.status === "pass"
      ? chalk.green("✔ PASS")
      : result.status === "warn"
        ? chalk.yellow("⚠ WARN")
        : chalk.red("✖ FAIL");

  console.log(chalk.bold(`\n  ${statusIcon}  ${result.templateName}`));
  console.log(`  Matched: ${result.matched}/${result.total} tags\n`);

  if (result.issues.length === 0) {
    console.log(chalk.green("  All tags match template definition.\n"));
    return;
  }

  for (const issue of result.issues) {
    const icon =
      issue.type === "missing"
        ? chalk.red("✖")
        : issue.type === "extra_tag"
          ? chalk.yellow("?")
          : chalk.yellow("~");
    console.log(`  ${icon} ${issue.tagName}`);
    console.log(
      `    ${chalk.gray(issue.type)}: expected=${issue.expected ?? "—"}, actual=${issue.actual ?? "—"}`,
    );
    if (issue.detail) {
      console.log(`    ${chalk.gray(issue.detail)}`);
    }
    if (issue.recommendation) {
      console.log(`    ${chalk.cyan(issue.recommendation)}`);
    }
  }
  console.log();
}

// ═══════════════════════════════════════════════════════════
// VALIDATE ALL — scan every template against a container
// ═══════════════════════════════════════════════════════════

export interface InstalledTagSnapshot {
  name: string;
  type: string;
  html?: string;
  consentType?: string;
  triggerEvent?: string | string[];
}

export interface ValidateAllOptions {
  pixelId?: string;
  measurementId?: string;
  conversionId?: string;
  /** Only include templates whose expected tags have at least this many matches in the container. */
  minMatches?: number;
}

export interface ValidateAllResult {
  totalTemplatesScanned: number;
  relevantTemplates: number;
  overallStatus: "pass" | "warn" | "fail";
  results: ValidationResult[];
  skipped: Array<{ templateId: string; templateName: string; reason: string }>;
}

/**
 * Validate every known template against a container snapshot and return the
 * subset that appear to be installed (i.e. at least one matching tag exists).
 *
 * This powers `templates validate --all`, the drift-detection foundation.
 */
export function validateAllTemplates(
  installedTags: InstalledTagSnapshot[],
  options: ValidateAllOptions = {},
): ValidateAllResult {
  const minMatches = Math.max(1, options.minMatches ?? 1);
  const allTemplates = getTemplates();
  const normalizeTagName = (name: string): string =>
    name
      .toLowerCase()
      .replace(/[–—]/g, "-")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();

  const installedNormalized = installedTags.map((t) => normalizeTagName(t.name));
  const results: ValidationResult[] = [];
  const skipped: ValidateAllResult["skipped"] = [];

  for (const template of allTemplates) {
    const inputs: Record<string, string> = {};
    try {
      for (const req of template.requiredInputs) {
        const resolved = getRequiredInputValue(req, options) ?? req.example;
        inputs[req.key] = resolved;
      }
      const expectedTags = template.tags(inputs);
      // Count how many expected tag names have a fuzzy match in the container
      let matchHits = 0;
      for (const expected of expectedTags) {
        const expectedNorm = normalizeTagName(expected.name);
        const hit = installedNormalized.some(
          (n) => n === expectedNorm || n.includes(expectedNorm) || expectedNorm.includes(n),
        );
        if (hit) matchHits++;
      }
      if (matchHits < minMatches) {
        skipped.push({
          templateId: template.id,
          templateName: template.name,
          reason: "No installed tags match this template",
        });
        continue;
      }
      results.push(validateInstalledTags(template.id, installedTags, options));
    } catch (err) {
      skipped.push({
        templateId: template.id,
        templateName: template.name,
        reason: (err as Error).message,
      });
    }
  }

  const overallStatus: "pass" | "warn" | "fail" = results.some((r) => r.status === "fail")
    ? "fail"
    : results.some((r) => r.status === "warn")
      ? "warn"
      : "pass";

  return {
    totalTemplatesScanned: allTemplates.length,
    relevantTemplates: results.length,
    overallStatus,
    results,
    skipped,
  };
}

export function printValidateAllResult(result: ValidateAllResult): void {
  const statusIcon =
    result.overallStatus === "pass"
      ? chalk.green("✔ PASS")
      : result.overallStatus === "warn"
        ? chalk.yellow("⚠ WARN")
        : chalk.red("✖ FAIL");

  console.log(chalk.bold(`\n  ${statusIcon}  Template Drift Scan`));
  console.log(
    `  Scanned ${result.totalTemplatesScanned} templates · ${result.relevantTemplates} relevant to this container\n`,
  );

  if (result.relevantTemplates === 0) {
    console.log(
      chalk.gray(
        "  No installed tags matched any known template. Run 'tagops templates list' to see what TagOps knows about.\n",
      ),
    );
    return;
  }

  for (const r of result.results) {
    printValidationResult(r);
  }

  const passed = result.results.filter((r) => r.status === "pass").length;
  const warned = result.results.filter((r) => r.status === "warn").length;
  const failed = result.results.filter((r) => r.status === "fail").length;
  console.log(chalk.bold("  Summary"));
  console.log(
    `    ${chalk.green("Pass")}: ${passed}   ${chalk.yellow("Warn")}: ${warned}   ${chalk.red("Fail")}: ${failed}`,
  );
  console.log();
}
