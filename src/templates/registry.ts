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
  TRIGGER_MAP,
  VARIABLE_MAP,
  discoverTriggerByEvent,
} from "../lib/architecture.js";
import { requireWriteAccess } from "../lib/permission-guard.js";

// ── Template types ──

export interface TemplateTag {
  name: string;
  type: string;
  html: string;
  triggerEvent: string; // Key into TRIGGER_MAP or "all_pages"
  consentType?: string;
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
  requiredInputs: Array<{ key: string; name: string; description: string; example: string }>;
  tags: (inputs: Record<string, string>) => TemplateTag[];
  variables?: TemplateVariable[];
}

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
  vendor: string;
  category: string;
  requiredInputs: Array<{ key: string; name: string; description: string; example: string }>;
}

export interface InstallAction {
  type: "tag" | "trigger" | "variable";
  name: string;
  action: "created" | "dry_run" | "failed";
  detail?: string;
}

export interface InstallResult {
  templateId: string;
  templateName: string;
  dryRun: boolean;
  actions: InstallAction[];
  summary: { tags: number; triggers: number; variables: number; failed: number };
}

export interface InstallOptions {
  dryRun: boolean;
  pixelId?: string;
  measurementId?: string;
}

function getTriggerDisplayName(triggerEvent: string): string {
  if (triggerEvent === "all_pages") {
    return "All Pages";
  }

  return TRIGGER_MAP[triggerEvent]?.name ?? triggerEvent;
}

// ── Template definitions ──
// Each template is lazy-loaded to keep this registry file lean.

function getTemplates(): IntegrationTemplate[] {
  return [
    // ── GA4 Enhanced Ecommerce ──
    {
      id: "ga4-ecommerce",
      name: "GA4 Enhanced Ecommerce",
      description:
        "Full GA4 e-commerce tracking: page_view, view_item, add_to_cart, begin_checkout, purchase + user properties",
      vendor: "Google",
      category: "analytics",
      requiredInputs: [
        {
          key: "measurementId",
          name: "GA4 Measurement ID",
          description: "Your GA4 Measurement ID",
          example: "G-XXXXXXXXXX",
        },
      ],
      tags: (inputs) => [
        {
          name: "GA4 - Page View",
          type: "gaawe",
          html: "",
          triggerEvent: "page_view",
        },
        {
          name: "GA4 - View Item",
          type: "gaawe",
          html: "",
          triggerEvent: "view_item",
        },
        {
          name: "GA4 - Add to Cart",
          type: "gaawe",
          html: "",
          triggerEvent: "add_to_cart",
        },
        {
          name: "GA4 - Begin Checkout",
          type: "gaawe",
          html: "",
          triggerEvent: "begin_checkout",
        },
        {
          name: "GA4 - Purchase",
          type: "gaawe",
          html: "",
          triggerEvent: "purchase",
        },
      ],
    },

    // ── CRM Offline Conversions (Google Ads) ──
    {
      id: "crm-offline-conversions",
      name: "CRM Offline Conversions (Google Ads)",
      description:
        "Captures Google Ads Click IDs (GCLID, WBRAID, GBRAID) and writes them to local storage for CRM form submission pickup.",
      vendor: "Google",
      category: "marketing",
      requiredInputs: [],
      tags: () => [
        {
          name: "Custom HTML - Capture Offline GCLID",
          type: "html",
          html: `<script>
(function() {
  function getParam(p) {
    var match = RegExp('[?&]' + p + '=([^&]*)').exec(window.location.search);
    return match && decodeURIComponent(match[1].replace(/\\+/g, ' '));
  }
  var gclid = getParam('gclid');
  var wbraid = getParam('wbraid');
  var gbraid = getParam('gbraid');
  
  if (gclid) localStorage.setItem('gclid', gclid);
  if (wbraid) localStorage.setItem('wbraid', wbraid);
  if (gbraid) localStorage.setItem('gbraid', gbraid);
})();
</script>`,
          triggerEvent: "page_view",
          consentType: "ad_storage",
        },
      ],
      variables: [
        {
          name: "JS - Get GCLID",
          type: "jsm",
          config: {
            value: "function() { return localStorage.getItem('gclid'); }",
          },
        },
        {
          name: "JS - Get WBRAID",
          type: "jsm",
          config: {
            value: "function() { return localStorage.getItem('wbraid'); }",
          },
        },
        {
          name: "JS - Get GBRAID",
          type: "jsm",
          config: {
            value: "function() { return localStorage.getItem('gbraid'); }",
          },
        },
      ],
    },

    // ── Meta Pixel ──
    {
      id: "meta-pixel",
      name: "Meta Pixel (Facebook)",
      description:
        "Meta Pixel with PageView, ViewContent, AddToCart, InitiateCheckout, Purchase + event ID dedup",
      vendor: "Meta",
      category: "advertising",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Meta Pixel ID",
          description: "Your Meta (Facebook) Pixel ID",
          example: "1234567890",
        },
      ],
      tags: (inputs) => {
        const pid = inputs.pixelId;
        return [
          {
            name: "Meta – PageView",
            type: "html",
            html: `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init','${pid}');fbq('track','PageView');</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Meta – ViewContent",
            type: "html",
            html: `<script>fbq('track','ViewContent',{content_ids:{{DLV - Content IDs}},content_type:'product',value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}},{eventID:{{Event ID}}});</script>`,
            triggerEvent: "view_item",
            consentType: "ad_storage",
          },
          {
            name: "Meta – AddToCart",
            type: "html",
            html: `<script>fbq('track','AddToCart',{content_ids:{{DLV - Content IDs}},content_type:'product',value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}},{eventID:{{Event ID}}});</script>`,
            triggerEvent: "add_to_cart",
            consentType: "ad_storage",
          },
          {
            name: "Meta – InitiateCheckout",
            type: "html",
            html: `<script>fbq('track','InitiateCheckout',{value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}},{eventID:{{Event ID}}});</script>`,
            triggerEvent: "begin_checkout",
            consentType: "ad_storage",
          },
          {
            name: "Meta – Purchase",
            type: "html",
            html: `<script>fbq('track','Purchase',{value:{{JS - Ecommerce Value (Number)}},currency:{{DLV - Ecommerce Currency}},content_ids:{{DLV - Content IDs}},content_type:'product'},{eventID:{{Event ID}}});</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Google Ads ──
    {
      id: "google-ads",
      name: "Google Ads Conversion Tracking",
      description: "Google Ads conversion tracking + remarketing tag for purchase events",
      vendor: "Google",
      category: "advertising",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Conversion ID",
          description: "Google Ads Conversion ID",
          example: "AW-1234567890",
        },
      ],
      tags: (inputs) => {
        const cid = inputs.pixelId;
        return [
          {
            name: "Google Ads – Conversion (Purchase)",
            type: "html",
            html: `<script>gtag('event','conversion',{'send_to':'${cid}/purchase','value':{{JS - Ecommerce Value (Number)}},'currency':{{DLV - Ecommerce Currency}},'transaction_id':{{DLV - Transaction ID}}});</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
          {
            name: "Google Ads – Remarketing",
            type: "html",
            html: `<script>gtag('event','page_view',{'send_to':'${cid}'});</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── TikTok Pixel (production SPA-safe scripts from live container) ──
    {
      id: "tiktok-pixel",
      name: "TikTok Pixel",
      description:
        "TikTok Pixel with SPA-safe base loader, ViewContent, AddToCart, InitiateCheckout, CompletePayment",
      vendor: "TikTok",
      category: "social",
      requiredInputs: [
        {
          key: "pixelId",
          name: "TikTok Pixel ID",
          description: "Your TikTok Pixel ID",
          example: "CXXXXXXXXXX",
        },
      ],
      tags: (inputs) => {
        const pid = inputs.pixelId;
        return [
          {
            name: "TikTok – Base Pixel Loader",
            type: "html",
            html: `<script>\n(function () {\n  if (window.__tnm_tiktok_base_loaded) return;\n  window.__tnm_tiktok_base_loaded = true;\n  if (window.ttq && window.ttq.load) return;\n  !function (w, d, t) {\n    w.TiktokAnalyticsObject = t;\n    var ttq = w[t] = w[t] || [];\n    ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];\n    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } };\n    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);\n    ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e };\n    ttq.load = function (e, n) { var i = "https://analytics.tiktok.com/i18n/pixel/events.js"; ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = i; ttq._t = ttq._t || {}; ttq._t[e] = +new Date; ttq._o = ttq._o || {}; ttq._o[e] = n || {}; var o = document.createElement("script"); o.type = "text/javascript"; o.async = !0; o.src = i + "?sdkid=" + e; var a = document.getElementsByTagName("script")[0]; a.parentNode.insertBefore(o, a) };\n    ttq.load('${pid}');\n    ttq.page();\n  }(window, document, 'ttq');\n})();\n</script>`,
            triggerEvent: "all_pages",
            consentType: "ad_storage",
          },
          {
            name: "TikTok – Page View (SPA)",
            type: "html",
            html: `<script>\n  if (window.ttq && typeof window.ttq.page === "function") {\n    window.ttq.page();\n  }\n</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "TikTok – View Content",
            type: "html",
            html: `<script>\n  if (window.ttq && typeof window.ttq.track === "function") {\n    var ids = {{JS – Meta Content IDs (SKU)}};\n    var contentId = Array.isArray(ids) ? String(ids[0]) : String(ids || '');\n    ttq.track('ViewContent', {\n      content_id: contentId,\n      content_type: 'product',\n      content_name: '{{JS – Meta Content Name}}',\n      value: {{JS - Ecommerce Value (Number)}},\n      currency: '{{DLV - Ecommerce Currency}}'\n    });\n  }\n</script>`,
            triggerEvent: "view_item",
            consentType: "ad_storage",
          },
          {
            name: "TikTok – Add To Cart",
            type: "html",
            html: `<script>\n  if (window.ttq && typeof window.ttq.track === "function") {\n    ttq.track('AddToCart', {\n      content_id: '{{JS – Meta Content IDs (SKU)}}',\n      content_type: 'product',\n      value: {{JS - Ecommerce Value (Number)}},\n      currency: '{{DLV - Ecommerce Currency}}',\n      quantity: Number({{JS - Meta Num Items}})\n    });\n  }\n</script>`,
            triggerEvent: "add_to_cart",
            consentType: "ad_storage",
          },
          {
            name: "TikTok – Initiate Checkout",
            type: "html",
            html: `<script>\n  if (window.ttq && typeof window.ttq.track === "function") {\n    ttq.track('InitiateCheckout', {\n      value: Number({{JS - Ecommerce Value (Number)}}),\n      currency: '{{DLV - Ecommerce Currency}}',\n      quantity: Number({{JS - Meta Num Items}})\n    });\n  }\n</script>`,
            triggerEvent: "begin_checkout",
            consentType: "ad_storage",
          },
          {
            name: "TikTok – Purchase",
            type: "html",
            html: `<script>\n  if (window.ttq && typeof window.ttq.track === "function") {\n    ttq.track('CompletePayment', {\n      contents: {{JS - Meta Contents}},\n      value: {{JS - Ecommerce Value (Number)}},\n      currency: '{{DLV - Ecommerce Currency}}',\n      order_id: '{{DLV - Transaction ID}}'\n    });\n  }\n</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Pinterest Tag ──
    {
      id: "pinterest-tag",
      name: "Pinterest Tag",
      description: "Pinterest conversion tracking: PageVisit, ViewCategory, AddToCart, Checkout",
      vendor: "Pinterest",
      category: "social",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Pinterest Tag ID",
          description: "Your Pinterest Tag ID",
          example: "1234567890",
        },
      ],
      tags: (inputs) => {
        const pid = inputs.pixelId;
        return [
          {
            name: "Pinterest – Base Tag",
            type: "html",
            html: `<script>!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");pintrk('load','${pid}');pintrk('page');</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Pinterest – ViewCategory",
            type: "html",
            html: `<script>pintrk('track','viewcategory');</script>`,
            triggerEvent: "view_item",
            consentType: "ad_storage",
          },
          {
            name: "Pinterest – AddToCart",
            type: "html",
            html: `<script>pintrk('track','addtocart',{value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}});</script>`,
            triggerEvent: "add_to_cart",
            consentType: "ad_storage",
          },
          {
            name: "Pinterest – Checkout",
            type: "html",
            html: `<script>pintrk('track','checkout',{value:{{JS - Ecommerce Value (Number)}},currency:{{DLV - Ecommerce Currency}},order_id:{{DLV - Transaction ID}}});</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Klaviyo (production script from live container) ──
    {
      id: "klaviyo",
      name: "Klaviyo Onsite Tracking",
      description:
        "Klaviyo JavaScript snippet for onsite tracking, identify calls, and marketing automation",
      vendor: "Klaviyo",
      category: "marketing",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Klaviyo Public API Key",
          description: "Your Klaviyo public API key (company_id)",
          example: "SFwUtB",
        },
      ],
      tags: (inputs) => {
        const apiKey = inputs.pixelId;
        return [
          {
            name: "Klaviyo Tracking",
            type: "html",
            html: `<script async type='text/javascript' src='https://static.klaviyo.com/onsite/js/${apiKey}/klaviyo.js?company_id=${apiKey}'></script>\n<script type="text/javascript">\n!function(){if(!window.klaviyo){window._klOnsite=window._klOnsite||[];try{window.klaviyo=new Proxy({},{get:function(n,i){return"push"===i?function(){var n;(n=window._klOnsite).push.apply(n,arguments)}:function(){for(var n=arguments.length,o=new Array(n),w=0;w<n;w++)o[w]=arguments[w];var t="function"==typeof o[o.length-1]?o.pop():void 0,e=new Promise((function(n){window._klOnsite.push([i].concat(o,[function(i){t&&t(i),n(i)}]))}));return e}}})}catch(n){window.klaviyo=window.klaviyo||[],window.klaviyo.push=function(){var n;(n=window._klOnsite).push.apply(n,arguments)}}}}();\n</script>`,
            triggerEvent: "all_pages",
            consentType: "analytics_storage",
          },
        ];
      },
    },

    // ── Snapchat Pixel ──
    {
      id: "snapchat-pixel",
      name: "Snapchat Pixel",
      description: "Snapchat conversion tracking: PAGE_VIEW, VIEW_CONTENT, ADD_CART, PURCHASE",
      vendor: "Snapchat",
      category: "social",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Snap Pixel ID",
          description: "Your Snapchat Pixel ID",
          example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
        },
      ],
      tags: (inputs) => {
        const pid = inputs.pixelId;
        return [
          {
            name: "Snapchat – Base + PageView",
            type: "html",
            html: `<script>(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','${pid}');snaptr('track','PAGE_VIEW');</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Snapchat – VIEW_CONTENT",
            type: "html",
            html: `<script>snaptr('track','VIEW_CONTENT',{price:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}});</script>`,
            triggerEvent: "view_item",
            consentType: "ad_storage",
          },
          {
            name: "Snapchat – ADD_CART",
            type: "html",
            html: `<script>snaptr('track','ADD_CART',{price:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}});</script>`,
            triggerEvent: "add_to_cart",
            consentType: "ad_storage",
          },
          {
            name: "Snapchat – PURCHASE",
            type: "html",
            html: `<script>snaptr('track','PURCHASE',{price:{{JS - Ecommerce Value (Number)}},currency:{{DLV - Ecommerce Currency}},transaction_id:{{DLV - Transaction ID}}});</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Reddit Pixel (from live TNM container) ──
    {
      id: "reddit-pixel",
      name: "Reddit Conversion Pixel",
      description:
        "Reddit Ads conversion tracking: PageVisit, ViewContent, AddToCart, InitiateCheckout, Purchase",
      vendor: "Reddit",
      category: "advertising",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Reddit Pixel ID",
          description: "Your Reddit Ads Pixel ID",
          example: "t2_xxxxxxxxxx",
        },
      ],
      tags: (inputs) => {
        const pid = inputs.pixelId;
        return [
          {
            name: "REDDIT – Page Visit",
            type: "html",
            html: `<script>\n!function(w,d){if(!w.rdt){var p=w.rdt=function(){p.sendEvent?p.sendEvent.apply(p,arguments):p.callQueue.push(arguments)};p.callQueue=[];var t=d.createElement("script");t.src="https://www.redditstatic.com/ads/pixel.js",t.async=!0;var s=d.getElementsByTagName("script")[0];s.parentNode.insertBefore(t,s)}}(window,document);rdt('init','${pid}');rdt('track','PageVisit');\n</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "REDDIT – ViewContent",
            type: "html",
            html: `<script>\n  if (typeof rdt === "function") {\n    rdt('track', 'ViewContent', {\n      content_ids: {{JS - Reddit Content IDs (Array)}},\n      content_name: '{{JS – Meta Content Name}}',\n      value: Number({{JS - Ecommerce Value (Number)}}),\n      currency: '{{DLV - Ecommerce Currency}}'\n    });\n  }\n</script>`,
            triggerEvent: "view_item",
            consentType: "ad_storage",
          },
          {
            name: "REDDIT – AddToCart",
            type: "html",
            html: `<script>\n  if (typeof rdt === "function") {\n    rdt('track', 'AddToCart', {\n      content_ids: {{JS - Reddit Content IDs (Array)}},\n      value: Number({{JS - Ecommerce Value (Number)}}),\n      currency: '{{DLV - Ecommerce Currency}}',\n      num_items: Number({{JS - Meta Num Items}})\n    });\n  }\n</script>`,
            triggerEvent: "add_to_cart",
            consentType: "ad_storage",
          },
          {
            name: "REDDIT – Initiate Checkout",
            type: "html",
            html: `<script>\n  if (typeof rdt === "function") {\n    rdt('track','InitiateCheckout', {\n      value: {{JS - Ecommerce Value (Number)}},\n      currency: '{{DLV - Ecommerce Currency}}'\n    });\n  }\n</script>`,
            triggerEvent: "begin_checkout",
            consentType: "ad_storage",
          },
          {
            name: "REDDIT – Purchase",
            type: "html",
            html: `<script>\n  if (typeof rdt === "function") {\n    rdt('track', 'Purchase', {\n      transaction_id: '{{DLV - Transaction ID}}',\n      value: {{JS - Ecommerce Value (Number)}},\n      currency: '{{DLV - Ecommerce Currency}}',\n      tax: {{JS - Ecommerce Tax (Number)}},\n      shipping: {{JS - Ecommerce Shipping (Number)}},\n      coupon: '{{DLV - Coupon Code}}'\n    });\n  }\n</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Taboola Pixel (from live TNM container) ──
    {
      id: "taboola-pixel",
      name: "Taboola Pixel",
      description:
        "Taboola conversion tracking: page_view, PRODUCT_VIEW, ADD_TO_CART, CHECKOUT, PURCHASE",
      vendor: "Taboola",
      category: "advertising",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Taboola Account ID",
          description: "Your Taboola pixel account ID",
          example: "1969618",
        },
      ],
      tags: (inputs) => {
        const accountId = inputs.pixelId;
        return [
          {
            name: "TABOOLA – Base Script",
            type: "html",
            html: `<script>\nwindow._tfa = window._tfa || [];\nwindow._tfa.push({ notify: 'event', name: 'page_view', id: ${accountId} });\n!function (t, f, a, x) {\n  if (!document.getElementById(x)) {\n    t.async = 1; t.src = a; t.id = x;\n    f.parentNode.insertBefore(t, f);\n  }\n}(document.createElement('script'), document.getElementsByTagName('script')[0], '//cdn.taboola.com/libtrc/unip/${accountId}/tfa.js', 'tb_tfa_script');\n</script>`,
            triggerEvent: "all_pages",
            consentType: "ad_storage",
          },
          {
            name: "TABOOLA – Page View (SPA)",
            type: "html",
            html: `<script>\n(function () {\n  window._tfa = window._tfa || [];\n  window._tfa.push({ notify: 'event', name: 'page_view', id: ${accountId} });\n})();\n</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "TABOOLA – Product View",
            type: "html",
            html: `<script>\n(function () {\n  window._tfa = window._tfa || [];\n  window._tfa.push({\n    notify: 'ecevent',\n    name: 'PRODUCT_VIEW',\n    id: ${accountId},\n    productIds: {{JS - Reddit Content IDs (Array)}}\n  });\n})();\n</script>`,
            triggerEvent: "view_item",
            consentType: "ad_storage",
          },
          {
            name: "TABOOLA – Add To Cart",
            type: "html",
            html: `<script>\n(function () {\n  window._tfa = window._tfa || [];\n  window._tfa.push({\n    notify: 'ecevent',\n    name: 'ADD_TO_CART',\n    id: ${accountId},\n    productIds: {{JS - Reddit Content IDs (Array)}}\n  });\n})();\n</script>`,
            triggerEvent: "add_to_cart",
            consentType: "ad_storage",
          },
          {
            name: "TABOOLA – Start Checkout",
            type: "html",
            html: `<script>\n(function () {\n  window._tfa = window._tfa || [];\n  window._tfa.push({\n    notify: 'ecevent',\n    name: 'CHECKOUT',\n    id: ${accountId},\n    productIds: {{JS - Reddit Content IDs (Array)}}\n  });\n})();\n</script>`,
            triggerEvent: "begin_checkout",
            consentType: "ad_storage",
          },
          {
            name: "TABOOLA – Purchase",
            type: "html",
            html: `<script>\n(function () {\n  window._tfa = window._tfa || [];\n  window._tfa.push({\n    notify: 'ecevent',\n    name: 'PURCHASE',\n    id: ${accountId},\n    cartDetails: {{JS – Taboola Cart Details}},\n    orderId: '{{DLV - Transaction ID}}',\n    value: {{JS - Ecommerce Value (Number)}},\n    currency: '{{DLV - Ecommerce Currency}}'\n  });\n})();\n</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Artsai / iHeart Radio (from create-artsai tool) ──
    {
      id: "artsai-iheart",
      name: "Artsai (iHeart Radio)",
      description:
        "iHeart Artsai conversion pixels: purchase, signup, registration, lead, content view, misc",
      vendor: "iHeart Media",
      category: "advertising",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Artsai Pixel ID",
          description: "Your Artsai pixel UUID",
          example: "8c599a46-94fb-484b-a46e-5a3fe33b3388",
        },
      ],
      tags: (inputs) => {
        const pid = inputs.pixelId;
        // Static pixel helper — matches exact format from iHeart/Claritas spec
        function staticPixel(action: string, extras = ""): string {
          return `<img src="https://arttrk.com/pixel/?ad_log=referer&action=${action}${extras}&pixid=${pid}" width="1" height="1" border="0" style="display:none">`;
        }
        return [
          {
            name: "Artsai – Purchase",
            type: "html",
            html: `<script>\n(function(){\n  var value = {{JS - Ecommerce Value (Number)}} || "";\n  var orderId = {{DLV - Transaction ID}} || "";\n  var img = new Image(1, 1);\n  img.src = "https://arttrk.com/pixel/?ad_log=referer&action=purchase"\n    + "&value=" + encodeURIComponent(value)\n    + "&order_id=" + encodeURIComponent(orderId)\n    + "&pixid=${pid}";\n})();\n</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
          {
            name: "Artsai – Signup",
            type: "html",
            html: staticPixel("signup"),
            triggerEvent: "begin_checkout",
            consentType: "ad_storage",
          },
          {
            name: "Artsai – Registration",
            type: "html",
            html: staticPixel("registration"),
            triggerEvent: "view_item",
            consentType: "ad_storage",
          },
          {
            name: "Artsai – Lead",
            type: "html",
            html: staticPixel("lead"),
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Artsai – Content",
            type: "html",
            html: staticPixel("content"),
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Artsai – Misc (Reserved)",
            type: "html",
            html: staticPixel("misc"),
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── MINTY / AddShoppers (from live TNM container) ──
    {
      id: "minty-addshoppers",
      name: "MINTY (AddShoppers)",
      description:
        "AddShoppers/MINTY social commerce: base widget loader + purchase conversion tracking",
      vendor: "AddShoppers",
      category: "marketing",
      requiredInputs: [
        {
          key: "pixelId",
          name: "AddShoppers Widget ID",
          description: "Your AddShoppers widget hash ID",
          example: "6979d88f164ae1058b182784",
        },
      ],
      tags: (inputs) => {
        const widgetId = inputs.pixelId;
        return [
          {
            name: "MINTY - Global Site Tag",
            type: "html",
            html: `<script type="text/javascript">\n(function () {\n  if (window.__tnm_addshoppers_loaded) return;\n  window.__tnm_addshoppers_loaded = true;\n  window.AddShoppersWidgetOptions = { loadCss: false, pushResponse: false };\n  if (document.getElementById("AddShoppers")) return;\n  var t = document.createElement("script");\n  t.type = "text/javascript";\n  t.async = true;\n  t.id = "AddShoppers";\n  t.src = "https://shop.pe/widget/widget_async.js#${widgetId}";\n  document.getElementsByTagName("head")[0].appendChild(t);\n})();\n</script>`,
            triggerEvent: "all_pages",
            consentType: "ad_storage",
          },
          {
            name: "MINTY - Conversion Tag",
            type: "html",
            html: `<script>\n(function () {\n  window.AddShoppersConversion = {\n    order_id: "{{DLV - Transaction ID}}",\n    value: "{{JS - Ecommerce Value (Number)}}",\n    currency: "{{DLV - Ecommerce Currency}}"\n  };\n  if (!document.getElementById("AddShoppers")) {\n    var t = document.createElement("script");\n    t.type = "text/javascript";\n    t.async = true;\n    t.id = "AddShoppers";\n    t.src = "https://shop.pe/widget/widget_async.js#${widgetId}";\n    document.getElementsByTagName("head")[0].appendChild(t);\n  }\n})();\n</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Ascendia Prime / ReadTargeting (from live TNM container) ──
    {
      id: "ascendia-prime",
      name: "Ascendia Prime (ReadTargeting)",
      description: "Ascendia Prime retargeting script for display advertising",
      vendor: "Ascendia",
      category: "retargeting",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Ascendia Script ID",
          description: "Your ReadTargeting script hash",
          example: "hr59lfl757n0z96dt3i4azdy",
        },
      ],
      tags: (inputs) => {
        const scriptId = inputs.pixelId;
        return [
          {
            name: "Ascendia Prime",
            type: "html",
            html: `<script type='text/javascript' src='https://static-cdn.readtargeting.com/${scriptId}.js' async='true'></script>`,
            triggerEvent: "all_pages",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Checkmate (from live TNM container) ──
    {
      id: "checkmate",
      name: "Checkmate Attribution",
      description: "Checkmate referral attribution tracking — base pixel + UTM cookie attribution",
      vendor: "Checkmate",
      category: "attribution",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Shopify Store Handle",
          description: "Your Shopify store handle for the Checkmate app",
          example: "tnmeats",
        },
      ],
      tags: (inputs) => {
        const store = inputs.pixelId;
        return [
          {
            name: "Checkmate Base Pixel",
            type: "html",
            html: `<script>\nif (!window.__checkmate_loaded) {\n  window.__checkmate_loaded = true;\n  var s = document.createElement("script");\n  s.async = true;\n  s.src = "https://${store}.myshopify.com/apps/cm/v1/load?source=gtm";\n  document.head.appendChild(s);\n}\n</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Checkmate Attribution",
            type: "html",
            html: `<script>\n(function() {\n  try {\n    var attrib = '{{1P - tnm_attrib}}';\n    if (!attrib || attrib === 'undefined' || attrib === 'null' || attrib.trim() === '') return;\n    window.checkmate = window.checkmate || {};\n    if (window.checkmate.attribution && window.checkmate.attribution.trim() !== '') return;\n    window.checkmate.attribution = attrib;\n  } catch (e) { console.warn('Checkmate attribution error', e); }\n})();\n</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Store Attribution",
            type: "html",
            html: `<script>\n(function() {\n  function setCookie(name, value, days) {\n    var d = new Date();\n    d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));\n    var cookie = name + "=" + encodeURIComponent(value) + "; path=/; expires=" + d.toUTCString() + "; SameSite=Lax";\n    if (location.protocol === "https:") cookie += "; Secure";\n    document.cookie = cookie;\n  }\n  var params = new URLSearchParams(window.location.search);\n  var keys = ["utm_source","utm_medium","utm_campaign","utm_content","utm_term","gclid","gbraid","wbraid","fbclid","ttclid","msclkid"];\n  var out = {};\n  for (var i = 0; i < keys.length; i++) {\n    var v = params.get(keys[i]);\n    if (v) out[keys[i]] = v;\n  }\n  if (Object.keys(out).length) setCookie("tnm_attrib", JSON.stringify(out), 30);\n})();\n</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Vibe (streaming audio/CTV pixel) ──
    {
      id: "vibe-pixel",
      name: "Vibe Pixel",
      description: "Vibe streaming audio/CTV conversion pixel",
      vendor: "Vibe",
      category: "advertising",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Vibe Pixel ID",
          description: "Your Vibe pixel tracking ID (from Vibe dashboard)",
          example: "vibe-xxxxxxxx",
        },
      ],
      tags: (_inputs) => {
        // Vibe uses a Community Template (cvt_5M39B) — installed via GTM UI
        // This template creates the tag config needed to point to the widget
        return [
          {
            name: "Vibe Pixel",
            type: "html",
            html: `<!-- Vibe Pixel: Install via GTM Community Template Gallery (search "Vibe") -->\n<!-- This template requires the Vibe Community Template to be added to your container first -->`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Shopify Custom Pixel (GTM integration for checkout) ──
    {
      id: "shopify-custom-pixel",
      name: "Shopify Custom Pixel (GTM)",
      description:
        "Complete Shopify Custom Pixel: loads GTM container + subscribes to all checkout events (page_viewed, product_viewed, cart_viewed, checkout_started, checkout_completed, payment_info_submitted, collection_viewed, search_submitted)",
      vendor: "Shopify",
      category: "platform",
      requiredInputs: [
        {
          key: "pixelId",
          name: "GTM Container ID",
          description: "Your GTM Container ID (GTM-XXXXXXX)",
          example: "GTM-XXXXXXX",
        },
      ],
      tags: (inputs) => {
        const gtmId = inputs.pixelId;
        return [
          {
            name: "Shopify – GTM Custom Pixel (All Events)",
            type: "html",
            html: `<!-- Shopify Custom Pixel: Paste this into Settings > Customer events > Add custom pixel -->\n<script>\n// ── GTM Container Loader ──\n(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':\nnew Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],\nj=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=\n'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);\n})(window,document,'script','dataLayer','${gtmId}');\n\n// ── Shopify Event Subscriptions ──\n// Each event pushes structured e-commerce data to GTM's dataLayer\n\n// Page View\nanalytics.subscribe('page_viewed', (event) => {\n  window.dataLayer.push({\n    event: 'page_viewed',\n    page_title: event.context.document.title,\n    page_location: event.context.document.location.href\n  });\n});\n\n// Product Viewed\nanalytics.subscribe('product_viewed', (event) => {\n  const p = event.data.productVariant;\n  window.dataLayer.push({\n    event: 'product_viewed',\n    ecommerce: {\n      currency: p.price.currencyCode,\n      value: parseFloat(p.price.amount),\n      items: [{\n        item_id: p.sku || p.id,\n        item_name: p.title,\n        item_variant: p.title,\n        price: parseFloat(p.price.amount),\n        quantity: 1\n      }]\n    }\n  });\n});\n\n// Collection Viewed\nanalytics.subscribe('collection_viewed', (event) => {\n  const c = event.data.collection;\n  window.dataLayer.push({\n    event: 'collection_viewed',\n    collection_id: c.id,\n    collection_title: c.title,\n    ecommerce: {\n      items: (c.productVariants || []).map((p, i) => ({\n        item_id: p.sku || p.id,\n        item_name: p.title,\n        price: parseFloat(p.price.amount),\n        index: i\n      }))\n    }\n  });\n});\n\n// Search Submitted\nanalytics.subscribe('search_submitted', (event) => {\n  window.dataLayer.push({\n    event: 'search_submitted',\n    search_term: event.data.searchResult.query\n  });\n});\n\n// Cart Viewed\nanalytics.subscribe('cart_viewed', (event) => {\n  const cart = event.data.cart;\n  window.dataLayer.push({\n    event: 'cart_viewed',\n    ecommerce: {\n      currency: cart.cost.totalAmount.currencyCode,\n      value: parseFloat(cart.cost.totalAmount.amount),\n      items: cart.lines.map((line, i) => ({\n        item_id: line.merchandise.sku || line.merchandise.id,\n        item_name: line.merchandise.title,\n        price: parseFloat(line.merchandise.price.amount),\n        quantity: line.quantity,\n        index: i\n      }))\n    }\n  });\n});\n\n// Checkout Started\nanalytics.subscribe('checkout_started', (event) => {\n  const checkout = event.data.checkout;\n  window.dataLayer.push({\n    event: 'checkout_started',\n    ecommerce: {\n      currency: checkout.currencyCode,\n      value: parseFloat(checkout.totalPrice.amount),\n      items: checkout.lineItems.map((item, i) => ({\n        item_id: item.variant.sku || item.variant.id,\n        item_name: item.title,\n        item_variant: item.variant.title,\n        price: parseFloat(item.variant.price.amount),\n        quantity: item.quantity,\n        index: i\n      }))\n    }\n  });\n});\n\n// Payment Info Submitted\nanalytics.subscribe('payment_info_submitted', (event) => {\n  const checkout = event.data.checkout;\n  window.dataLayer.push({\n    event: 'payment_info_submitted',\n    ecommerce: {\n      currency: checkout.currencyCode,\n      value: parseFloat(checkout.totalPrice.amount)\n    }\n  });\n});\n\n// Checkout Completed (Purchase)\nanalytics.subscribe('checkout_completed', (event) => {\n  const checkout = event.data.checkout;\n  window.dataLayer.push({\n    event: 'checkout_completed',\n    ecommerce: {\n      transaction_id: checkout.order.id,\n      value: parseFloat(checkout.totalPrice.amount),\n      tax: parseFloat(checkout.totalTax.amount),\n      shipping: parseFloat(checkout.shippingLine.price.amount),\n      currency: checkout.currencyCode,\n      coupon: (checkout.discountApplications[0] || {}).title || '',\n      items: checkout.lineItems.map((item, i) => ({\n        item_id: item.variant.sku || item.variant.id,\n        item_name: item.title,\n        item_variant: item.variant.title,\n        price: parseFloat(item.variant.price.amount),\n        quantity: item.quantity,\n        index: i\n      }))\n    }\n  });\n});\n</script>`,
            triggerEvent: "all_pages",
          },
        ];
      },
    },

    // ── AspireIQ / Aspire (TUNE-based affiliate tracking) ──
    {
      id: "aspireiq",
      name: "AspireIQ (Aspire Influencer)",
      description:
        "Aspire influencer marketing: TUNE-based click tracking (all pages) + conversion tracking (purchase with order subtotal)",
      vendor: "Aspire",
      category: "affiliate",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Aspire Advertiser ID",
          description: "Your TUNE/Aspire advertiser ID",
          example: "aspireiq",
        },
      ],
      tags: (inputs) => {
        const networkId = inputs.pixelId || "aspireiq";
        return [
          {
            name: "AspireIQ – Click Tracker",
            type: "html",
            html: `<script>\n(function() {\n  // Aspire / TUNE Click Tracking\n  // Fires on all pages EXCEPT the conversion page\n  var tuneScript = document.createElement('script');\n  tuneScript.type = 'text/javascript';\n  tuneScript.async = true;\n  tuneScript.src = 'https://${networkId}.go2cloud.org/aff_l?offer_id=' +\n    (new URLSearchParams(window.location.search).get('offer_id') || '') +\n    '&aff_id=' + (new URLSearchParams(window.location.search).get('aff_id') || '');\n  if (new URLSearchParams(window.location.search).get('offer_id')) {\n    document.head.appendChild(tuneScript);\n  }\n})();\n</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "AspireIQ – Conversion",
            type: "html",
            html: `<script>\n(function() {\n  // Aspire / TUNE Conversion Tracking\n  var img = new Image();\n  img.src = 'https://${networkId}.go2cloud.org/aff_goal' +\n    '?a=conversion' +\n    '&goal_id=0' +\n    '&adv_sub=' + encodeURIComponent('{{DLV - Transaction ID}}') +\n    '&amount=' + encodeURIComponent({{JS - Ecommerce Value (Number)}}) +\n    '&_ef_transaction_id=' + encodeURIComponent('{{DLV - Transaction ID}}');\n})();\n</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Impact.com (affiliate network) ──
    {
      id: "impact-com",
      name: "Impact.com Affiliate Tracking",
      description:
        "Impact.com affiliate: Universal Tracking Tag (all pages) + Identify (user matching) + trackConversion (purchase with line items)",
      vendor: "Impact",
      category: "affiliate",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Impact Account SID",
          description: "Your Impact.com account SID (campaign ID)",
          example: "IRxxxxxxxx",
        },
      ],
      tags: (inputs) => {
        const accountSid = inputs.pixelId;
        return [
          {
            name: "Impact – Universal Tracking Tag",
            type: "html",
            html: `<script type="text/javascript">\n(function() {\n  // Impact.com Universal Tracking Tag (UTT)\n  // Must load first — fires on ALL pages\n  var ire = window.ire = window.ire || [];\n  if (ire.loaded) return;\n  ire.loaded = true;\n  var a = document.createElement('script');\n  a.type = 'text/javascript';\n  a.async = true;\n  a.src = 'https://utt.impactcdn.com/A${accountSid}-${accountSid}1.js';\n  var b = document.getElementsByTagName('script')[0];\n  b.parentNode.insertBefore(a, b);\n\n  // Signal UTT loaded for sequencing\n  window.dataLayer = window.dataLayer || [];\n  window.dataLayer.push({ event: 'ImpactUttLoaded' });\n})();\n</script>`,
            triggerEvent: "all_pages",
            consentType: "ad_storage",
          },
          {
            name: "Impact – Identify",
            type: "html",
            html: `<script type="text/javascript">\n// Impact.com Identify Function\n// Fires after UTT loads — identifies returning users\n(function() {\n  if (typeof ire !== 'undefined' && ire.identify) {\n    ire('identify', {\n      customerId: '',    // Populate with logged-in customer ID if available\n      customerEmail: ''  // Populate with hashed email if available\n    });\n  }\n})();\n</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Impact – Conversion (Purchase)",
            type: "html",
            html: `<script type="text/javascript">\n// Impact.com Conversion Tracking\n// Fires on purchase confirmation\n(function() {\n  if (typeof ire !== 'undefined' && ire.trackConversion) {\n    ire('trackConversion', ${accountSid.replace(/[^0-9]/g, "") || "0"}, {\n      orderId: '{{DLV - Transaction ID}}',\n      customerId: '',\n      customerEmail: '',\n      currencyCode: '{{DLV - Ecommerce Currency}}',\n      orderPromoCode: '{{DLV - Coupon Code}}',\n      items: [{\n        subTotal: {{JS - Ecommerce Value (Number)}},\n        category: 'ecommerce',\n        sku: '',\n        quantity: 1\n      }]\n    });\n  }\n})();\n</script>`,
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Retention.com (formerly GetEmails) — from paused TNM tags ──
    {
      id: "retention-com",
      name: "Retention.com (GetEmails)",
      description:
        "Retention.com identity resolution: base geq.js loader + page tracking for abandoned cart/browse recovery",
      vendor: "Retention.com",
      category: "marketing",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Retention API Key",
          description: "Your Retention.com site key",
          example: "X2JHJWZG",
        },
      ],
      tags: (inputs) => {
        const apiKey = inputs.pixelId;
        return [
          {
            name: "Retention.com – Base Script",
            type: "html",
            html: `<script type="text/javascript">\n!function(){var geq=window.geq=window.geq||[];if(geq.initialize) return;if (geq.invoked){if (window.console && console.error) {console.error("GE snippet included twice.");}return;}geq.invoked = true;geq.methods = ["page", "suppress", "track", "doNotTrack", "trackOrder", "identify", "addToCart", "callBack", "event"];geq.factory = function(method){return function(){var args = Array.prototype.slice.call(arguments);args.unshift(method);geq.push(args);return geq;};};for (var i = 0; i < geq.methods.length; i++) {var key = geq.methods[i];geq[key] = geq.factory(key);} geq.load = function(key){var script = document.createElement("script");script.type = "text/javascript";script.async = true; if (location.href.includes("vge=true")) {script.src = "https://s3-us-west-2.amazonaws.com/jsstore/a/" + key + "/ge.js?v=" + Math.random();} else {script.src = "https://s3-us-west-2.amazonaws.com/jsstore/a/" + key + "/ge.js";} var first = document.getElementsByTagName("script")[0];first.parentNode.insertBefore(script, first);};geq.SNIPPET_VERSION = "1.6.1";\ngeq.load("${apiKey}");}();\n</script>`,
            triggerEvent: "all_pages",
            consentType: "ad_storage",
          },
          {
            name: "Retention.com – Page Track",
            type: "html",
            html: `<script>geq.page()</script>`,
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
        ];
      },
    },

    // ── Magellan AI (iHeart / podcast attribution) ──
    // ⚠ UNVERIFIED: SDK URL (cdn.magellan.ai/sdk.js) and MAI.emit() API are best-effort.
    //   Validate against Brandon's Excel spec before deploying to production.
    {
      id: "magellan-ai",
      name: "Magellan AI Attribution Pixel",
      description:
        "Magellan AI podcast attribution pixel: SDK loader, page view, purchase, checkout, bundle builder tracking via MAI.emit",
      vendor: "Magellan AI",
      category: "attribution",
      requiredInputs: [
        {
          key: "pixelId",
          name: "Magellan API Token",
          description: "Your Magellan AI pixel API token",
          example: "019cd8d8037677ab85faf4f598184962",
        },
      ],
      tags: (inputs) => {
        const token = inputs.pixelId;
        return [
          {
            name: "Magellan – View (All Pages)",
            type: "html",
            html: [
              `<script>`,
              `(function() {`,
              `  if (window.__mai_loaded) return;`,
              `  window.__mai_loaded = true;`,
              `  var s = document.createElement('script');`,
              `  s.async = true;`,
              `  s.src = 'https://cdn.magellan.ai/sdk.js';`,
              `  s.onload = function() {`,
              `    if (typeof MAI !== 'undefined') {`,
              `      MAI.init('${token}');`,
              `      MAI.emit('pageview', { url: window.location.href });`,
              `    }`,
              `  };`,
              `  document.head.appendChild(s);`,
              `})();`,
              `</script>`,
            ].join("\n"),
            triggerEvent: "page_view",
            consentType: "ad_storage",
          },
          {
            name: "Magellan – Purchase",
            type: "html",
            html: [
              `<script>`,
              `(function() {`,
              `  if (typeof MAI !== 'undefined' && MAI.emit) {`,
              `    MAI.emit('purchase', {`,
              `      value: {{JS - Ecommerce Value (Number)}} || 0,`,
              `      order_id: '{{DLV - Transaction ID}}' || '',`,
              `      url: window.location.href`,
              `    });`,
              `  }`,
              `})();`,
              `</script>`,
            ].join("\n"),
            triggerEvent: "purchase",
            consentType: "ad_storage",
          },
          {
            name: "Magellan – Checkout",
            type: "html",
            html: [
              `<script>`,
              `(function() {`,
              `  if (typeof MAI !== 'undefined' && MAI.emit) {`,
              `    MAI.emit('checkout', { url: window.location.href });`,
              `  }`,
              `})();`,
              `</script>`,
            ].join("\n"),
            triggerEvent: "begin_checkout",
            consentType: "ad_storage",
          },
          {
            name: "Magellan – Bundle Builder",
            type: "html",
            html: [
              `<script>`,
              `(function() {`,
              `  if (typeof MAI !== 'undefined' && MAI.emit) {`,
              `    MAI.emit('view_item', { url: window.location.href });`,
              `  }`,
              `})();`,
              `</script>`,
            ].join("\n"),
            triggerEvent: "view_item",
            consentType: "ad_storage",
          },
        ];
      },
    },
  ];
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
      console.log(`    ${chalk.cyan(t.id.padEnd(20))} ${t.name}`);
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
    const value = input.key === "measurementId" ? options.measurementId : options.pixelId;
    if (!value && !options.dryRun) {
      throw new Error(
        `Missing required input: --${input.key === "measurementId" ? "measurement-id" : "pixel-id"} (${input.name})\n  Example: ${input.example}`,
      );
    }
    inputs[input.key] = value ?? "EXAMPLE_ID";
  }

  const actions: InstallAction[] = [];
  let tagCount = 0;
  const triggerCount = 0;
  let variableCount = 0;
  let failedCount = 0; // eslint-disable-line prefer-const

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
    const triggerId = options.dryRun
      ? null
      : tag.triggerEvent === "all_pages"
        ? ALL_PAGES_TRIGGER_ID
        : await discoverTriggerByEvent(tag.triggerEvent);

    if (options.dryRun) {
      actions.push({
        type: "tag",
        name: tag.name,
        action: "dry_run",
        detail: `trigger: ${triggerName}`,
      });
      tagCount++;
    } else {
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

      if (tag.type === "html" && tag.html) {
        const config = buildHtmlTagConfig(tag.html, tag.consentType);
        // Smart firing option: page-level tags → oncePerLoad, conversion tags → oncePerEvent
        const isPageLevel = tag.triggerEvent === "page_view" || tag.triggerEvent === "all_pages";
        config.tagFiringOption = isPageLevel ? "oncePerLoad" : "oncePerEvent";

        const result = await createTag({
          name: tag.name,
          type: "html",
          firingTriggerId: triggerId,
          config,
        });
        if (result) {
          actions.push({ type: "tag", name: tag.name, action: "created" });
          tagCount++;
        } else {
          actions.push({ type: "tag", name: tag.name, action: "failed" });
          failedCount++;
        }
      } else {
        // GA4 event tags handled differently (would use googtag/gaawe type)
        actions.push({
          type: "tag",
          name: tag.name,
          action: "dry_run",
          detail: "GA4 native tags — use GTM UI",
        });
        tagCount++;
      }
    }
  }

  return {
    templateId,
    templateName: template.name,
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
  console.log(chalk.bold(`\n  ${prefix}Installing: ${result.templateName}\n`));

  for (const action of result.actions) {
    const icon =
      action.action === "created"
        ? chalk.green("✔")
        : action.action === "dry_run"
          ? chalk.cyan("○")
          : chalk.red("✖");
    const detail = action.detail ? chalk.gray(` (${action.detail})`) : "";
    console.log(`  ${icon} [${action.type}] ${action.name}${detail}`);
  }

  const s = result.summary;
  console.log(chalk.bold("\n  Summary"));
  console.log(`    Tags:      ${s.tags}`);
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
  }>;
  variables: TemplateVariable[];
}

export function previewTemplate(
  templateId: string,
  options: { pixelId?: string; measurementId?: string } = {},
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

  // Use example values for any missing required inputs
  for (const req of template.requiredInputs) {
    if (!inputs[req.key]) {
      inputs[req.key] = options.pixelId ?? req.example;
    }
  }

  const tags = template.tags(inputs);

  return {
    templateId: template.id,
    templateName: template.name,
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
    })),
    variables: template.variables ?? [],
  };
}

export function printPreviewResult(result: PreviewResult): void {
  console.log(chalk.bold(`\n  Template Preview: ${result.templateName}\n`));
  console.log(`  ${chalk.gray("Vendor:")}     ${result.vendor}`);
  console.log(`  ${chalk.gray("Category:")}   ${result.category}`);
  console.log(`  ${chalk.gray("ID:")}         ${result.templateId}`);
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
    if (tag.html) {
      console.log(chalk.gray("  ─── HTML ───────────────────────────────────"));
      // Indent and dim the HTML
      const lines = tag.html.split("\\n").join("\n").split("\n");
      for (const line of lines) {
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
  options: { pixelId?: string; measurementId?: string } = {},
): ValidationResult {
  const template = getTemplates().find((t) => t.id === templateId);
  if (!template) {
    throw new Error(`Template '${templateId}' not found.`);
  }

  const inputs: Record<string, string> = {};
  if (options.pixelId) inputs.pixelId = options.pixelId;
  if (options.measurementId) inputs.measurementId = options.measurementId;
  for (const req of template.requiredInputs) {
    if (!inputs[req.key]) inputs[req.key] = req.example;
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
