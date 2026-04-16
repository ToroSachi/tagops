/**
 * Taboola Pixel template (from live TNM container)
 */
import type { IntegrationTemplate } from "./types.js";

export const taboolaPixel: IntegrationTemplate = {
  id: "taboola-pixel",
  version: "1.0.0",
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
};
