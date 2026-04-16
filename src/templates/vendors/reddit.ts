/**
 * Reddit Conversion Pixel template (from live TNM container)
 */
import type { IntegrationTemplate } from "./types.js";

export const redditPixel: IntegrationTemplate = {
  id: "reddit-pixel",
  version: "1.0.0",
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
};
