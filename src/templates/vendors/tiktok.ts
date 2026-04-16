/**
 * TikTok Pixel template (SPA-safe scripts from live container)
 */
import type { IntegrationTemplate } from "./types.js";
import { jsStringLiteral } from "./types.js";

export const tiktokPixel: IntegrationTemplate = {
  id: "tiktok-pixel",
  version: "1.0.0",
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
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    const pixelIdLiteral = jsStringLiteral(inputs.pixelId);
    return [
      {
        name: "TikTok – Base Pixel Loader",
        type: "html",
        html: `<script>\n(function () {\n  if (window.__tnm_tiktok_base_loaded) return;\n  window.__tnm_tiktok_base_loaded = true;\n  if (window.ttq && window.ttq.load) return;\n  !function (w, d, t) {\n    w.TiktokAnalyticsObject = t;\n    var ttq = w[t] = w[t] || [];\n    ttq.methods = ["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie"];\n    ttq.setAndDefer = function (t, e) { t[e] = function () { t.push([e].concat(Array.prototype.slice.call(arguments, 0))) } };\n    for (var i = 0; i < ttq.methods.length; i++) ttq.setAndDefer(ttq, ttq.methods[i]);\n    ttq.instance = function (t) { for (var e = ttq._i[t] || [], n = 0; n < ttq.methods.length; n++) ttq.setAndDefer(e, ttq.methods[n]); return e };\n    ttq.load = function (e, n) { var i = "https://analytics.tiktok.com/i18n/pixel/events.js"; ttq._i = ttq._i || {}; ttq._i[e] = []; ttq._i[e]._u = i; ttq._t = ttq._t || {}; ttq._t[e] = +new Date; ttq._o = ttq._o || {}; ttq._o[e] = n || {}; var o = document.createElement("script"); o.type = "text/javascript"; o.async = !0; o.src = i + "?sdkid=" + e; var a = document.getElementsByTagName("script")[0]; a.parentNode.insertBefore(o, a) };\n    ttq.load(${pixelIdLiteral});\n  }(window, document, 'ttq');\n})();\n</script>`,
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
        html: `<script>\n  if (window.ttq && typeof window.ttq.track === "function") {\n    ttq.track('ViewContent', {\n      contents: {{JS - Meta Contents}},\n      content_type: 'product',\n      content_name: '{{JS – Meta Content Name}}',\n      value: {{JS - Ecommerce Value (Number)}},\n      currency: '{{DLV - Ecommerce Currency}}'\n    });\n  }\n</script>`,
        triggerEvent: "view_item",
        consentType: "ad_storage",
      },
      {
        name: "TikTok – Add To Cart",
        type: "html",
        html: `<script>\n  if (window.ttq && typeof window.ttq.track === "function") {\n    ttq.track('AddToCart', {\n      contents: {{JS - Meta Contents}},\n      content_type: 'product',\n      value: {{JS - Ecommerce Value (Number)}},\n      currency: '{{DLV - Ecommerce Currency}}',\n      quantity: Number({{JS - Meta Num Items}})\n    });\n  }\n</script>`,
        triggerEvent: "add_to_cart",
        consentType: "ad_storage",
      },
      {
        name: "TikTok – Initiate Checkout",
        type: "html",
        html: `<script>\n  if (window.ttq && typeof window.ttq.track === "function") {\n    ttq.track('InitiateCheckout', {\n      contents: {{JS - Meta Contents}},\n      value: Number({{JS - Ecommerce Value (Number)}}),\n      currency: '{{DLV - Ecommerce Currency}}',\n      quantity: Number({{JS - Meta Num Items}})\n    });\n  }\n</script>`,
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
};
