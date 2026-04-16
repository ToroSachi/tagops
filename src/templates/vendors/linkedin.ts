/**
 * LinkedIn Insight Tag template
 */
import type { IntegrationTemplate } from "./types.js";
import { jsStringLiteral } from "./types.js";

export const linkedinInsight: IntegrationTemplate = {
  id: "linkedin-insight",
  version: "1.0.0",
  name: "LinkedIn Insight Tag",
  description:
    "LinkedIn Insight base tag with All Pages page view plus ViewContent and Purchase conversion events",
  vendor: "LinkedIn",
  category: "social",
  requiredInputs: [
    {
      key: "pixelId",
      name: "LinkedIn Partner ID",
      description: "Your LinkedIn Insight partner ID",
      example: "123456",
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    const partnerId = inputs.pixelId;
    const partnerIdLiteral = jsStringLiteral(partnerId);

    return [
      {
        name: "LinkedIn – Insight Base + Page View",
        type: "html",
        html: `<script>
(function() {
  window._linkedin_data_partner_ids = window._linkedin_data_partner_ids || [];
  if (window._linkedin_data_partner_ids.indexOf(${partnerIdLiteral}) === -1) {
    window._linkedin_data_partner_ids.push(${partnerIdLiteral});
  }
  if (!window.lintrk) {
    window.lintrk = function(a, b) {
      window.lintrk.q.push([a, b]);
    };
    window.lintrk.q = [];
  }
  if (window.__tnm_linkedin_insight_loaded) return;
  window.__tnm_linkedin_insight_loaded = true;
  var script = document.createElement("script");
  script.type = "text/javascript";
  script.async = true;
  script.src = "https://snap.licdn.com/li.lms-analytics/insight.min.js";
  var firstScript = document.getElementsByTagName("script")[0];
  firstScript.parentNode.insertBefore(script, firstScript);
})();
</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
      },
      {
        name: "LinkedIn – ViewContent",
        type: "html",
        html: `<script>
(function() {
  if (typeof lintrk !== "function") return;
  var conversionId = ${partnerIdLiteral};
  lintrk("track", {
    conversion_id: conversionId
  });
})();
</script>`,
        triggerEvent: "view_item",
        consentType: "ad_storage",
        note: "Replace the default conversion_id with your LinkedIn event-specific conversion ID if it differs from the partner ID.",
      },
      {
        name: "LinkedIn – Purchase",
        type: "html",
        html: `<script>
(function() {
  if (typeof lintrk !== "function") return;
  var conversionId = ${partnerIdLiteral};
  lintrk("track", {
    conversion_id: conversionId,
    conversion_value: Number({{JS - Ecommerce Value (Number)}}),
    currency: "{{DLV - Ecommerce Currency}}"
  });
})();
</script>`,
        triggerEvent: "purchase",
        consentType: "ad_storage",
        note: "Replace the default conversion_id with your LinkedIn event-specific conversion ID if it differs from the partner ID.",
      },
    ];
  },
};
