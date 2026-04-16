/**
 * Shared types and builder utilities for vendor template definitions.
 *
 * Every vendor file under ./vendors/ imports from here instead of
 * reaching into the registry internals.
 */

import { TRIGGER_MAP } from "../../lib/architecture.js";
import type { GtmParameter } from "../../types/gtm.js";

// ── Trigger / Install types ──

export type TemplateTriggerEvent =
  | keyof typeof TRIGGER_MAP
  | "all_pages"
  | "initialization"
  | "consent_initialization";

export type TemplateInstallMode = "create" | "unsupported" | "instruction_only";

export type TemplateInputValidator = "pixelId" | "measurementId" | "conversionId";

// ── Data contracts ──

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
  /**
   * Optional semver for the template definition. Bump when the tag set,
   * triggers, consent types, or configuration change in a way that would
   * require reinstalling. Consumed by `templates list`, `preview`, `install`,
   * and exported manifests.
   */
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

// ── Builder helpers ──

export function jsStringLiteral(value: string): string {
  return JSON.stringify(value);
}

export function buildConsentSettings(consentType?: string): Record<string, unknown> | undefined {
  if (!consentType) return undefined;
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

export function buildTemplateTagConfig(
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

export function buildEventSettingsParameter(
  parameter: string,
  parameterValue: string,
): GtmParameter {
  return {
    type: "map",
    map: [
      { type: "template", key: "parameter", value: parameter },
      { type: "template", key: "parameterValue", value: parameterValue },
    ],
  };
}

export function buildGa4EventTagConfig(
  eventName: string,
  measurementId: string,
  eventSettings: Array<[string, string]>,
): Record<string, unknown> {
  return buildTemplateTagConfig([
    { type: "boolean", key: "sendEcommerceData", value: "false" },
    {
      type: "list",
      key: "eventSettingsTable",
      list: eventSettings.map(([param, paramValue]) =>
        buildEventSettingsParameter(param, paramValue),
      ),
    },
    { type: "template", key: "eventName", value: eventName },
    { type: "template", key: "measurementIdOverride", value: measurementId },
  ]);
}
