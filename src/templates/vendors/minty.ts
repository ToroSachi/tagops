/**
 * MINTY / AddShoppers template (from live TNM container)
 */
import type { IntegrationTemplate } from "./types.js";

export const mintyAddshoppers: IntegrationTemplate = {
  id: "minty-addshoppers",
  version: "1.0.0",
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
};
