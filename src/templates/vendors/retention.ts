/**
 * Retention.com (formerly GetEmails) template — from paused TNM tags
 */
import type { IntegrationTemplate } from "./types.js";

export const retentionCom: IntegrationTemplate = {
  id: "retention-com",
  version: "1.0.0",
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
};
