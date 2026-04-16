/**
 * Artsai / iHeart Radio template (from create-artsai tool)
 */
import type { IntegrationTemplate } from "./types.js";

export const artsaiIheart: IntegrationTemplate = {
  id: "artsai-iheart",
  version: "1.0.0",
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
};
