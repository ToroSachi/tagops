/**
 * Ascendia Prime / ReadTargeting template (from live TNM container)
 */
import type { IntegrationTemplate } from "./types.js";

export const ascendiaPrime: IntegrationTemplate = {
  id: "ascendia-prime",
  version: "1.0.0",
  name: "Ascendia Prime (ReadTargeting)",
  description: "Ascendia Prime retargeting script for display advertising",
  vendor: "Ascendia",
  category: "retargeting",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Ascendia Script ID",
      description: "Your ReadTargeting script hash",
      example: "hr59lfl757n0z96dt3i4azdy",
    },
  ],
  tags: (inputs) => {
    const scriptId = inputs.pixelId;
    return [
      {
        name: "Ascendia Prime",
        type: "html",
        html: `<script type='text/javascript' src='https://static-cdn.readtargeting.com/${scriptId}.js' async='true'></script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
      },
    ];
  },
};
