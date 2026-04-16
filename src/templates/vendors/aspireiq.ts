/**
 * AspireIQ / Aspire (TUNE-based affiliate tracking)
 */
import type { IntegrationTemplate } from "./types.js";

export const aspireiq: IntegrationTemplate = {
  id: "aspireiq",
  version: "1.0.0",
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
};
