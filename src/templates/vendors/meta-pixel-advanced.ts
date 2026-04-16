/**
 * Meta Pixel Advanced template — full standard-event coverage, Advanced
 * Matching hooks, and Consent Mode v2 wiring.
 *
 * Use this instead of the base `meta-pixel` template when you need:
 *   - The full 14-event standard library (Lead, Search, Subscribe, etc.)
 *   - Advanced Matching (hashed PII) for Event Match Quality
 *   - `fbq('consent', ...)` tied to a consent variable (not just GTM-layer gating)
 *   - CAPI dedup via shared event_id + action_source + event_source_url
 *
 * Official references:
 *   Pixel reference:        https://developers.facebook.com/docs/meta-pixel/reference/
 *   Advanced Matching:      https://developers.facebook.com/docs/meta-pixel/advanced/advanced-matching/
 *   Deduplication:          https://www.facebook.com/business/help/823677331451951
 *   Conversions API:        https://developers.facebook.com/docs/marketing-api/conversions-api/
 *
 * The pixel auto-hashes `em`/`ph`/etc. values if you pass them as plaintext.
 * Always prefer passing them pre-normalized (lowercase, trimmed) and pre-hashed
 * with SHA-256 when possible to avoid leaking plaintext PII through the tag.
 *
 * NOTE ON DATA LAYER KEYS: this template expects the following DLVs to exist
 * (or be added via `tagops templates bundle`): Content IDs, Contents Array,
 * Ecommerce Value, Ecommerce Currency, Num Items, Event ID, User Data Email,
 * User Data Phone, User Data First Name, User Data Last Name, Consent Granted.
 */
import type { IntegrationTemplate } from "./types.js";
import { jsStringLiteral } from "./types.js";

export const metaPixelAdvanced: IntegrationTemplate = {
  id: "meta-pixel-advanced",
  version: "1.0.0",
  name: "Meta Pixel (Advanced)",
  description:
    "Full Meta Pixel with Advanced Matching + Consent Mode v2 + 14 standard events + CAPI dedup parameters.",
  vendor: "Meta",
  category: "advertising",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Meta Pixel ID",
      description: "Your Meta (Facebook) Pixel ID",
      example: "1234567890",
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    const pixelIdLiteral = jsStringLiteral(inputs.pixelId);

    // Reusable fragments
    const commonContentParams = `content_ids:{{DLV - Content IDs}},contents:{{DLV - Contents Array}},content_type:'product',value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}},num_items:{{DLV - Num Items}}`;
    const dedupSuffix = `{eventID:{{Event ID}}}`;

    return [
      // ── Base + Consent + Advanced Matching init ──
      {
        name: "Meta Advanced – Base Library + Consent",
        type: "html",
        html: `<script>\n!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');\n// Consent Mode: flip based on {{Consent Granted}} ("true"/"false")\nfbq('consent', {{Consent Granted}} === true ? 'grant' : 'revoke');\n// Advanced Matching — pixel will auto-hash plaintext, but prefer pre-hashed values\nfbq('init', ${pixelIdLiteral}, {\n  em: {{DLV - User Data Email}},\n  ph: {{DLV - User Data Phone}},\n  fn: {{DLV - User Data First Name}},\n  ln: {{DLV - User Data Last Name}}\n});\n</script>`,
        triggerEvent: "consent_initialization",
        consentType: "ad_storage",
        note: "Fires on Consent Initialization so the pixel library is ready before any later event calls.",
      },

      // ── Page / content events ──
      {
        name: "Meta Advanced – PageView",
        type: "html",
        html: `<script>fbq('track','PageView',{event_source_url:location.href},${dedupSuffix});</script>`,
        triggerEvent: "page_view",
        consentType: "ad_storage",
      },
      {
        name: "Meta Advanced – ViewContent",
        type: "html",
        html: `<script>fbq('track','ViewContent',{${commonContentParams}},${dedupSuffix});</script>`,
        triggerEvent: "view_item",
        consentType: "ad_storage",
      },
      {
        name: "Meta Advanced – Search",
        type: "html",
        html: `<script>fbq('track','Search',{search_string:{{DLV - Search String}},content_category:{{DLV - Search Category}}},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire this to a search-results custom event in your data layer, then change the trigger to that event.",
      },

      // ── Cart / checkout funnel ──
      {
        name: "Meta Advanced – AddToCart",
        type: "html",
        html: `<script>fbq('track','AddToCart',{${commonContentParams}},${dedupSuffix});</script>`,
        triggerEvent: "add_to_cart",
        consentType: "ad_storage",
      },
      {
        name: "Meta Advanced – AddToWishlist",
        type: "html",
        html: `<script>fbq('track','AddToWishlist',{${commonContentParams}},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire to a wishlist custom event in your data layer.",
      },
      {
        name: "Meta Advanced – InitiateCheckout",
        type: "html",
        html: `<script>fbq('track','InitiateCheckout',{${commonContentParams}},${dedupSuffix});</script>`,
        triggerEvent: "begin_checkout",
        consentType: "ad_storage",
      },
      {
        name: "Meta Advanced – AddPaymentInfo",
        type: "html",
        html: `<script>fbq('track','AddPaymentInfo',{${commonContentParams}},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire to an add_payment_info or checkout-step-2 custom event.",
      },
      {
        name: "Meta Advanced – Purchase",
        type: "html",
        html: `<script>fbq('track','Purchase',{${commonContentParams},action_source:'website',event_source_url:location.href},${dedupSuffix});</script>`,
        triggerEvent: "purchase",
        consentType: "ad_storage",
      },

      // ── Lead-gen events ──
      {
        name: "Meta Advanced – Lead",
        type: "html",
        html: `<script>fbq('track','Lead',{content_name:{{DLV - Lead Form Name}},content_category:{{DLV - Lead Category}},value:{{DLV - Lead Value}},currency:{{DLV - Ecommerce Currency}}},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire to your form-submit / lead custom event (e.g. GTM form submission trigger).",
      },
      {
        name: "Meta Advanced – CompleteRegistration",
        type: "html",
        html: `<script>fbq('track','CompleteRegistration',{content_name:{{DLV - Registration Type}},value:{{DLV - Lead Value}},currency:{{DLV - Ecommerce Currency}},status:true},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire to a signup-success custom event.",
      },
      {
        name: "Meta Advanced – Subscribe",
        type: "html",
        html: `<script>fbq('track','Subscribe',{value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}},predicted_ltv:{{DLV - Predicted LTV}}},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire to a subscription-start custom event (SaaS / newsletter / recurring).",
      },
      {
        name: "Meta Advanced – StartTrial",
        type: "html",
        html: `<script>fbq('track','StartTrial',{value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}},predicted_ltv:{{DLV - Predicted LTV}}},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire to a free-trial-start custom event.",
      },
      {
        name: "Meta Advanced – Contact",
        type: "html",
        html: `<script>fbq('track','Contact',{},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire to a chat-open, contact-form-submit, or click-to-call custom event.",
      },
      {
        name: "Meta Advanced – Schedule",
        type: "html",
        html: `<script>fbq('track','Schedule',{},${dedupSuffix});</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Wire to a booking / appointment-scheduled custom event (Calendly, Cal.com, etc.).",
      },
    ];
  },
};
