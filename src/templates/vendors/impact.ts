/**
 * Impact.com Affiliate Tracking template
 */
import type { IntegrationTemplate } from "./types.js";

export const impactCom: IntegrationTemplate = {
  id: "impact-com",
  version: "1.0.0",
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
};
