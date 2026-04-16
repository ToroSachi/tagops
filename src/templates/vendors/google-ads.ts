/**
 * Google Ads Conversion Tracking template
 */
import type { IntegrationTemplate } from "./types.js";
import { jsStringLiteral, buildTemplateTagConfig } from "./types.js";

export const googleAds: IntegrationTemplate = {
  id: "google-ads",
  version: "1.0.0",
  name: "Google Ads Conversion Tracking",
  description: "Google Ads conversion tracking + remarketing tag for purchase events",
  vendor: "Google",
  category: "advertising",
  requiredInputs: [
    {
      key: "conversionId",
      name: "Conversion ID",
      description: "Google Ads Conversion ID",
      example: "AW-1234567890",
      validator: "conversionId",
    },
  ],
  tags: (inputs) => {
    const conversionId = inputs.conversionId;
    const conversionIdLiteral = jsStringLiteral(conversionId);

    return [
      {
        name: "Google Ads – Google Tag",
        type: "googtag",
        config: buildTemplateTagConfig(
          [{ type: "template", key: "tagId", value: conversionId }],
          "ad_storage",
        ),
        triggerEvent: "initialization",
        consentType: "ad_storage",
        note: "Required dependency. This is the base Google tag equivalent to gtag('config', TAG_ID) and must exist before Google Ads event tags fire.",
      },
      {
        name: "Google Ads – Conversion Linker",
        type: "gclidw",
        config: buildTemplateTagConfig([], "ad_storage"),
        triggerEvent: "all_pages",
        consentType: "ad_storage",
        note: "Required dependency for Ads click ID persistence and attribution.",
      },
      {
        name: "Google Ads – Conversion (Purchase)",
        type: "awct",
        config: buildTemplateTagConfig(
          [
            { type: "template", key: "googleConversionId", value: conversionId },
            { type: "template", key: "value", value: "{{JS - Ecommerce Value (Number)}}" },
            { type: "template", key: "currencyCode", value: "{{DLV - Ecommerce Currency}}" },
            { type: "template", key: "transactionId", value: "{{DLV - Transaction ID}}" },
          ],
          "ad_storage",
        ),
        triggerEvent: "purchase",
        consentType: "ad_storage",
        note: "Configure the Google Ads conversion label in GTM or Google Ads. TagOps does not hardcode a '/purchase' label.",
      },
      {
        name: "Google Ads – Remarketing",
        type: "html",
        html: `<script>gtag('event','page_view',{'send_to':${conversionIdLiteral}});</script>`,
        triggerEvent: "page_view",
        consentType: "ad_storage",
        note: "Requires the base Google tag and Conversion Linker to already exist.",
      },
    ];
  },
};
