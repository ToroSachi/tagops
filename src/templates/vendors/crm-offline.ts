/**
 * CRM Offline Conversions (Google Ads) template
 *
 * Captures Google Ads Click IDs (GCLID, WBRAID, GBRAID) and writes
 * them to local storage for CRM form submission pickup.
 */
import type { IntegrationTemplate } from "./types.js";

export const crmOfflineConversions: IntegrationTemplate = {
  id: "crm-offline-conversions",
  version: "1.0.0",
  name: "CRM Offline Conversions (Google Ads)",
  description:
    "Captures Google Ads Click IDs (GCLID, WBRAID, GBRAID) and writes them to local storage for CRM form submission pickup.",
  vendor: "Google",
  category: "marketing",
  requiredInputs: [],
  tags: () => [
    {
      name: "Custom HTML - Capture Offline GCLID",
      type: "html",
      html: `<script>
(function() {
  function getParam(p) {
    var match = RegExp('[?&]' + p + '=([^&]*)').exec(window.location.search);
    return match && decodeURIComponent(match[1].replace(/\\+/g, ' '));
  }
  var gclid = getParam('gclid');
  var wbraid = getParam('wbraid');
  var gbraid = getParam('gbraid');
  
  if (gclid) localStorage.setItem('gclid', gclid);
  if (wbraid) localStorage.setItem('wbraid', wbraid);
  if (gbraid) localStorage.setItem('gbraid', gbraid);
})();
</script>`,
      triggerEvent: "page_view",
      consentType: "ad_storage",
    },
  ],
  variables: [
    {
      name: "JS - Get GCLID",
      type: "jsm",
      config: {
        value: "function() { return localStorage.getItem('gclid'); }",
      },
    },
    {
      name: "JS - Get WBRAID",
      type: "jsm",
      config: {
        value: "function() { return localStorage.getItem('wbraid'); }",
      },
    },
    {
      name: "JS - Get GBRAID",
      type: "jsm",
      config: {
        value: "function() { return localStorage.getItem('gbraid'); }",
      },
    },
  ],
};
