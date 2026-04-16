/**
 * Vendor template barrel — import all vendor definitions from a single place.
 *
 * Adding a new vendor?  Create vendors/my-vendor.ts, export a const,
 * then re-export it here and add it to `allVendorTemplates`.
 */

import { ga4Ecommerce } from "./ga4-ecommerce.js";
import { googleAds } from "./google-ads.js";
import { metaPixel } from "./meta-pixel.js";
import { linkedinInsight } from "./linkedin.js";
import { xPixel } from "./x-pixel.js";
import { bingUet } from "./bing-uet.js";
import { amazonAttribution } from "./amazon.js";
import { tiktokPixel } from "./tiktok.js";
import { pinterestTag } from "./pinterest.js";
import { klaviyo } from "./klaviyo.js";
import { snapchatPixel } from "./snapchat.js";
import { redditPixel } from "./reddit.js";
import { taboolaPixel } from "./taboola.js";
import { artsaiIheart } from "./artsai.js";
import { mintyAddshoppers } from "./minty.js";
import { ascendiaPrime } from "./ascendia.js";
import { checkmate } from "./checkmate.js";
import { vibePixel } from "./vibe.js";
import { shopifyCustomPixel } from "./shopify.js";
import { aspireiq } from "./aspireiq.js";
import { impactCom } from "./impact.js";
import { retentionCom } from "./retention.js";
import { magellanAi } from "./magellan.js";
import { crmOfflineConversions } from "./crm-offline.js";
import type { IntegrationTemplate } from "./types.js";

// Re-export individual vendors for direct imports
export { ga4Ecommerce } from "./ga4-ecommerce.js";
export { googleAds } from "./google-ads.js";
export { metaPixel } from "./meta-pixel.js";
export { linkedinInsight } from "./linkedin.js";
export { xPixel } from "./x-pixel.js";
export { bingUet } from "./bing-uet.js";
export { amazonAttribution } from "./amazon.js";
export { tiktokPixel } from "./tiktok.js";
export { pinterestTag } from "./pinterest.js";
export { klaviyo } from "./klaviyo.js";
export { snapchatPixel } from "./snapchat.js";
export { redditPixel } from "./reddit.js";
export { taboolaPixel } from "./taboola.js";
export { artsaiIheart } from "./artsai.js";
export { mintyAddshoppers } from "./minty.js";
export { ascendiaPrime } from "./ascendia.js";
export { checkmate } from "./checkmate.js";
export { vibePixel } from "./vibe.js";
export { shopifyCustomPixel } from "./shopify.js";
export { aspireiq } from "./aspireiq.js";
export { impactCom } from "./impact.js";
export { retentionCom } from "./retention.js";
export { magellanAi } from "./magellan.js";
export { crmOfflineConversions } from "./crm-offline.js";

// Re-export all shared types so consumers can import from one spot
export type {
  IntegrationTemplate,
  TemplateTag,
  TemplateVariable,
  TemplateInput,
  TemplateTriggerEvent,
  TemplateInstallMode,
  TemplateInputValidator,
} from "./types.js";

export {
  jsStringLiteral,
  buildConsentSettings,
  buildTemplateTagConfig,
  buildEventSettingsParameter,
  buildGa4EventTagConfig,
} from "./types.js";

/**
 * All vendor templates in one array.
 *
 * Order matches the original registry.ts inline array:
 * analytics → advertising → social → marketing → platform → affiliate → attribution → retargeting
 */
export const extractedVendorTemplates: IntegrationTemplate[] = [
  ga4Ecommerce,
  googleAds,
  metaPixel,
  crmOfflineConversions,
  linkedinInsight,
  xPixel,
  bingUet,
  amazonAttribution,
  tiktokPixel,
  pinterestTag,
  klaviyo,
  snapchatPixel,
  redditPixel,
  taboolaPixel,
  artsaiIheart,
  mintyAddshoppers,
  ascendiaPrime,
  checkmate,
  vibePixel,
  shopifyCustomPixel,
  aspireiq,
  impactCom,
  retentionCom,
  magellanAi,
];
