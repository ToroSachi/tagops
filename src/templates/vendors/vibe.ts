/**
 * Vibe Pixel template (streaming audio/CTV)
 */
import type { IntegrationTemplate } from "./types.js";
import { buildTemplateTagConfig } from "./types.js";

export const vibePixel: IntegrationTemplate = {
  id: "vibe-pixel",
  version: "1.0.0",
  name: "Vibe Pixel",
  description: "Vibe streaming audio/CTV conversion pixel",
  vendor: "Vibe",
  category: "advertising",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Vibe Pixel ID",
      description: "Your Vibe pixel tracking ID (from Vibe dashboard)",
      example: "vibe-xxxxxxxx",
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    return [
      {
        name: "Vibe Pixel",
        type: "cvt_5M39B",
        config: buildTemplateTagConfig(
          [
            { type: "template", key: "pixelId", value: inputs.pixelId },
            { type: "template", key: "pixelType", value: "page_view_pixel" },
          ],
          "ad_storage",
          { tagFiringOption: "oncePerEvent" },
        ),
        triggerEvent: "page_view",
        consentType: "ad_storage",
        note: "Requires the Vibe community template to already exist in this GTM container.",
      },
    ];
  },
};
