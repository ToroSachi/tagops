/**
 * HubSpot Tracking Code template
 *
 * HubSpot onsite tracking snippet. Identifies visitors, records pageviews,
 * and captures form submissions back to HubSpot CRM contacts.
 * Official docs: https://developers.hubspot.com/docs/api/events/tracking-code
 */
import type { IntegrationTemplate } from "./types.js";

export const hubspot: IntegrationTemplate = {
  id: "hubspot",
  version: "1.0.0",
  name: "HubSpot Tracking Code",
  description:
    "HubSpot onsite tracking — pageviews, form captures, contact identification. Portal-ID-keyed.",
  vendor: "HubSpot",
  category: "marketing",
  requiredInputs: [
    {
      key: "pixelId",
      name: "HubSpot Portal ID (Hub ID)",
      description:
        "Your HubSpot Portal/Hub ID — visible in your HubSpot URL or Settings → Account Defaults",
      example: "12345678",
    },
  ],
  tags: (inputs) => {
    const portalId = inputs.pixelId;
    return [
      {
        name: "HubSpot Tracking Code",
        type: "html",
        html: `<script type="text/javascript" id="hs-script-loader" async defer src="//js.hs-scripts.com/${portalId}.js"></script>`,
        triggerEvent: "all_pages",
        consentType: "analytics_storage",
        note: "For GDPR-strict setups, pass the tracker in 'doNotTrack' mode until consent — see https://legal.hubspot.com/privacy-policy",
      },
    ];
  },
};
