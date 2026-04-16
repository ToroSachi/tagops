/**
 * Checkmate Attribution template (from live TNM container)
 */
import type { IntegrationTemplate } from "./types.js";

export const checkmate: IntegrationTemplate = {
  id: "checkmate",
  version: "1.0.0",
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
};
