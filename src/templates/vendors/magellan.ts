/**
 * Magellan AI Attribution Pixel template (iHeart / podcast attribution)
 *
 * ⚠ UNVERIFIED: SDK URL (cdn.magellan.ai/sdk.js) and MAI.emit() API are best-effort.
 *   Validate against Brandon's Excel spec before deploying to production.
 */
import type { IntegrationTemplate } from "./types.js";

export const magellanAi: IntegrationTemplate = {
  id: "magellan-ai",
  version: "1.0.0",
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
};
