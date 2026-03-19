/**
 * GTM Architecture — constants, mappings, and naming conventions.
 *
 * Single source of truth for trigger maps, variable maps, naming conventions,
 * and type codes. Used by both CLI tools and MCP server.
 *
 * Account-specific values (accountId, containerId, workspaceId) are loaded
 * from .gtmrc.json via loadConfig(). See src/lib/config.ts.
 */

// ── Trigger Map ──

export interface TriggerEntry {
  id: string;
  name: string;
  event: string;
}

export const TRIGGER_MAP: Record<string, TriggerEntry> = {
  page_view: { id: "83", name: "CE - Page View", event: "ce_page_view" },
  user_data: { id: "84", name: "CE - User Data", event: "user_data" },
  add_to_cart: { id: "85", name: "CE - Add to Cart", event: "add_to_cart" },
  remove_from_cart: { id: "86", name: "CE - Remove from Cart", event: "remove_from_cart" },
  view_item: { id: "87", name: "CE - View Item", event: "view_item" },
  view_item_list: { id: "88", name: "CE - View Item List", event: "view_item_list" },
  begin_checkout: { id: "89", name: "CE - Begin Checkout", event: "begin_checkout" },
  select_item: { id: "90", name: "CE - Select Item", event: "select_item" },
  referral_landing: { id: "91", name: "CE - Referral Landing", event: "referral_landing" },
  purchase: { id: "35", name: "CE - Purchase", event: "purchase" },
} as const;

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
  purchase: TRIGGER_MAP.purchase.id,
  signup: TRIGGER_MAP.begin_checkout.id,
  checkout: TRIGGER_MAP.begin_checkout.id,
  begin_checkout: TRIGGER_MAP.begin_checkout.id,
  lead: TRIGGER_MAP.page_view.id,
  pageview: TRIGGER_MAP.page_view.id,
  page_view: TRIGGER_MAP.page_view.id,
  content: TRIGGER_MAP.page_view.id,
  view_item: TRIGGER_MAP.view_item.id,
  add_to_cart: TRIGGER_MAP.add_to_cart.id,
  registration: TRIGGER_MAP.view_item.id,
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
  "2147479553", // All Pages
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
