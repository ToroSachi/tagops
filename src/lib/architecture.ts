/**
 * GTM Architecture — constants, mappings, and naming conventions.
 *
 * Single source of truth for trigger maps, variable maps, naming conventions,
 * and type codes. Used by both CLI tools and MCP server.
 *
 * Account-specific values (accountId, containerId, workspaceId) are loaded
 * from .gtmrc.json via loadConfig(). See src/lib/config.ts.
 */

import { listTriggers } from "./gtm-cli.js";
import type { GtmFilterCondition, GtmTrigger } from "../types/gtm.js";

// ── Trigger Map ──

export interface TriggerEntry {
  id: string;
  name: string;
  event: string;
  namePattern: string;
}

export const TRIGGER_MAP: Record<string, TriggerEntry> = {
  page_view: {
    id: "page_view",
    name: "CE - Page View",
    event: "ce_page_view",
    namePattern: "^CE - Page View(?:$| \\()",
  },
  user_data: {
    id: "user_data",
    name: "CE - User Data",
    event: "user_data",
    namePattern: "^CE - User Data(?:$| \\()",
  },
  add_to_cart: {
    id: "add_to_cart",
    name: "CE - Add to Cart",
    event: "add_to_cart",
    namePattern: "^CE - Add to Cart(?:$| \\()",
  },
  remove_from_cart: {
    id: "remove_from_cart",
    name: "CE - Remove from Cart",
    event: "remove_from_cart",
    namePattern: "^CE - Remove from Cart(?:$| \\()",
  },
  view_item: {
    id: "view_item",
    name: "CE - View Item",
    event: "view_item",
    namePattern: "^CE - View Item(?:$| \\()",
  },
  view_item_list: {
    id: "view_item_list",
    name: "CE - View Item List",
    event: "view_item_list",
    namePattern: "^CE - View Item List(?:$| \\()",
  },
  begin_checkout: {
    id: "begin_checkout",
    name: "CE - Begin Checkout",
    event: "begin_checkout",
    namePattern: "^CE - Begin Checkout(?:$| \\()",
  },
  select_item: {
    id: "select_item",
    name: "CE - Select Item",
    event: "select_item",
    namePattern: "^CE - Select Item(?:$| \\()",
  },
  referral_landing: {
    id: "referral_landing",
    name: "CE - Referral Landing",
    event: "referral_landing",
    namePattern: "^CE - Referral Landing(?:$| \\()",
  },
  purchase: {
    id: "purchase",
    name: "CE - Purchase",
    event: "purchase",
    namePattern: "^CE - Purchase(?:$| \\()",
  },
} as const;

export const ALL_PAGES_TRIGGER_ID = "2147479553";

function getConditionParameterValue(
  condition: GtmFilterCondition,
  key: string,
): string | undefined {
  return condition.parameter.find((parameter) => parameter.key === key)?.value;
}

function getTriggerEntry(eventName: string): TriggerEntry | undefined {
  return TRIGGER_MAP[eventName];
}

function getMappedCustomEventName(eventName: string): string {
  return getTriggerEntry(eventName)?.event ?? eventName;
}

export function matchesCustomEventTrigger(trigger: GtmTrigger, eventName: string): boolean {
  if (trigger.type !== "CUSTOM_EVENT") {
    return false;
  }

  const customEventName = getMappedCustomEventName(eventName);
  return (trigger.customEventFilter ?? []).some((condition) => {
    const arg0 = getConditionParameterValue(condition, "arg0");
    const arg1 = getConditionParameterValue(condition, "arg1");

    if (arg1 !== customEventName) {
      return false;
    }

    return arg0 === undefined || arg0 === "{{_event}}" || arg0 === "_event";
  });
}

export function selectTriggerForEvent(
  triggers: GtmTrigger[],
  eventName: string,
): GtmTrigger | null {
  const triggerEntry = getTriggerEntry(eventName);
  const matchingTriggers = triggers.filter((trigger) =>
    matchesCustomEventTrigger(trigger, eventName),
  );

  if (matchingTriggers.length === 0) {
    return null;
  }

  if (!triggerEntry) {
    return matchingTriggers[0] ?? null;
  }

  const exactNameMatch = matchingTriggers.find((trigger) => trigger.name === triggerEntry.name);
  if (exactNameMatch) {
    return exactNameMatch;
  }

  const namePattern = new RegExp(triggerEntry.namePattern, "i");
  return matchingTriggers.find((trigger) => namePattern.test(trigger.name)) ?? matchingTriggers[0];
}

export async function discoverTriggerByEvent(eventName: string): Promise<string | null> {
  const trigger = selectTriggerForEvent(await listTriggers(), eventName);
  return trigger?.triggerId ?? null;
}

// ── Variable Map (DLV key → GTM variable name) ──

export const VARIABLE_MAP: Record<string, string> = {
  "ecommerce.value": "DLV - Ecommerce Value",
  "ecommerce.value.number": "JS - Ecommerce Value (Number)",
  "ecommerce.currency": "DLV - Ecommerce Currency",
  "ecommerce.items": "DLV - Ecommerce Items",
  "ecommerce.transaction_id": "DLV - Transaction ID",
  page_path: "DLV - Page Path",
  page_title: "DLV - Page Title",
  page_location: "DLV - Page Location",
  user_id: "DLV - User ID",
  content_ids: "DLV - Content IDs",
  event_id: "Event ID",
} as const;

// ── Action → Trigger mapping (for pixel implementations) ──

export const ACTION_TO_TRIGGER: Record<string, string> = {
  purchase: "purchase",
  signup: "begin_checkout",
  checkout: "begin_checkout",
  begin_checkout: "begin_checkout",
  lead: "page_view",
  pageview: "page_view",
  page_view: "page_view",
  content: "page_view",
  view_item: "view_item",
  add_to_cart: "add_to_cart",
  registration: "view_item",
};

// ── Naming conventions ──

export const NAMING = {
  variable: {
    dataLayer: (key: string) => `DLV - ${key}`,
    customJs: (desc: string) => `CJS - ${desc}`,
    constant: (desc: string) => `CONST - ${desc}`,
  },
  trigger: {
    customEvent: (event: string) => `CE - ${event}`,
    pageView: (desc?: string) => (desc ? `PV - ${desc}` : "PV - All Pages"),
    click: (desc: string) => `Click - ${desc}`,
  },
  tag: {
    ga4: (event: string) => `GA4 - ${event}`,
    meta: (event: string) => `Meta – ${event}`,
    vendor: (vendor: string, event: string) => `${vendor} – ${event}`,
  },
};

// ── Built-in trigger IDs (GTM system triggers to exclude from orphan checks) ──

export const BUILTIN_TRIGGER_IDS = new Set([
  ALL_PAGES_TRIGGER_ID, // All Pages
  "2147479572", // Initialization
  "2147479573", // Consent Initialization
]);

// ── Variable type codes ──

export const VARIABLE_TYPES: Record<string, string> = {
  c: "Constant",
  v: "Data Layer Variable",
  jsm: "Custom JavaScript",
  u: "URL Variable",
  k: "1st Party Cookie",
  j: "JavaScript Global Variable",
};

// ── Tag type codes ──

export const TAG_TYPES: Record<string, string> = {
  gaawc: "GA4 Configuration",
  gaawe: "GA4 Event",
  html: "Custom HTML",
  img: "Custom Image",
  googtag: "Google Tag",
};

// ── Vendor Detection Patterns (single source of truth) ──

/**
 * Lightweight pixel vendors — simple image/attribution pixels that only need
 * ad_storage consent. These must be checked BEFORE the general ad-vendor
 * patterns so they get the lighter consent requirement.
 */
export const LIGHTWEIGHT_PIXEL_PATTERNS: RegExp[] = [
  /artsai/i,
  /arttrk/i,
  /magellan/i,
  /mgln\.ai/i,
  /ascendia/i,
  /readtargeting/i,
  /checkmate/i,
  /aspireiq/i,
  /go2cloud/i,
];

/** Full advertising vendors — require ad_storage + ad_user_data + ad_personalization */
export const AD_VENDOR_PATTERNS: RegExp[] = [
  /meta/i,
  /facebook/i,
  /fbq/i,
  /tiktok/i,
  /ttq/i,
  /reddit/i,
  /pinterest/i,
  /pintrk/i,
  /snapchat/i,
  /snaptr/i,
  /taboola/i,
  /outbrain/i,
  /criteo/i,
  /linkedin/i,
  /twitter/i,
  /twq/i,
  /impact/i,
  /klaviyo/i,
  /retention/i,
  /adroll/i,
  /doubleclick/i,
  /vibe/i,
  /addshoppers/i,
];

/** Analytics vendor patterns in custom HTML */
export const ANALYTICS_VENDOR_PATTERNS: RegExp[] = [
  /gtag\(/i,
  /google-analytics/i,
  /ga\s*\(/i,
  /hotjar/i,
  /mixpanel/i,
  /segment/i,
  /amplitude/i,
  /heap/i,
  /fullstory/i,
  /clarity/i,
];

// ── Vendor Detection Helpers ──

export function isLightweightPixel(searchText: string): boolean {
  return LIGHTWEIGHT_PIXEL_PATTERNS.some((p) => p.test(searchText));
}

export function isAdVendor(searchText: string): boolean {
  if (isLightweightPixel(searchText)) return false;
  return AD_VENDOR_PATTERNS.some((p) => p.test(searchText));
}

export function isAnalyticsVendor(searchText: string): boolean {
  return ANALYTICS_VENDOR_PATTERNS.some((p) => p.test(searchText));
}
