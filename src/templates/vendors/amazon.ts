/**
 * Amazon Attribution template
 */
import type { IntegrationTemplate } from "./types.js";

export const amazonAttribution: IntegrationTemplate = {
  id: "amazon-attribution",
  version: "1.0.0",
  name: "Amazon Attribution",
  description: "Amazon Attribution purchase image pixel with transaction value tracking",
  vendor: "Amazon",
  category: "attribution",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Amazon Attribution Tag ID",
      description: "Your Amazon Attribution tag ID",
      example: "amzn-attribution-12345",
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    const attributionTagId = inputs.pixelId;

    return [
      {
        name: "Amazon – Attribution Purchase",
        type: "html",
        html: `<img src="https://s.amazon-adsystem.com/iu3?tag=${attributionTagId}&event=purchase&order_id={{DLV - Transaction ID}}&value={{JS - Ecommerce Value (Number)}}&currency={{DLV - Ecommerce Currency}}" height="1" width="1" style="display:none" alt="" />`,
        triggerEvent: "purchase",
        consentType: "ad_storage",
        note: "Uses a conservative custom-image implementation for Amazon Attribution. Verify the final query-string contract against the tag generated in Amazon Ads before publishing.",
      },
    ];
  },
};
