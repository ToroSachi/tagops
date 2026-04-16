/**
 * GA4 Enhanced Ecommerce template
 */
import type { IntegrationTemplate } from "./types.js";
import { buildGa4EventTagConfig } from "./types.js";

export const ga4Ecommerce: IntegrationTemplate = {
  id: "ga4-ecommerce",
  version: "1.0.0",
  name: "GA4 Enhanced Ecommerce",
  description:
    "Full GA4 e-commerce tracking: page_view, view_item, add_to_cart, begin_checkout, purchase + user properties",
  vendor: "Google",
  category: "analytics",
  requiredInputs: [
    {
      key: "measurementId",
      name: "GA4 Measurement ID",
      description: "Your GA4 Measurement ID",
      example: "G-XXXXXXXXXX",
      validator: "measurementId",
    },
  ],
  tags: (inputs) => {
    const measurementId = inputs.measurementId;
    const requiredNote =
      "Requires an existing GA4 Configuration / Google Tag in GTM. The measurementIdOverride links this event tag to your GA4 property.";

    return [
      {
        name: "GA4 - Page View",
        type: "gaawe",
        config: buildGa4EventTagConfig("page_view", measurementId, [
          ["page_type", "{{DLV - Page Type}}"],
          ["page_path", "{{DLV - Page Path}}"],
          ["page_title", "{{DLV - Page Title}}"],
        ]),
        triggerEvent: "page_view",
        consentType: "analytics_storage",
        note: requiredNote,
      },
      {
        name: "GA4 - View Item",
        type: "gaawe",
        config: buildGa4EventTagConfig("view_item", measurementId, [
          ["currency", "{{DLV - Ecommerce Currency}}"],
          ["value", "{{JS - Ecommerce Value (Number)}}"],
          ["items", "{{DLV - Ecommerce Items}}"],
        ]),
        triggerEvent: "view_item",
        consentType: "analytics_storage",
        note: requiredNote,
      },
      {
        name: "GA4 - Add to Cart",
        type: "gaawe",
        config: buildGa4EventTagConfig("add_to_cart", measurementId, [
          ["currency", "{{DLV - Ecommerce Currency}}"],
          ["value", "{{JS - Ecommerce Value (Number)}}"],
          ["items", "{{DLV - Ecommerce Items}}"],
        ]),
        triggerEvent: "add_to_cart",
        consentType: "analytics_storage",
        note: requiredNote,
      },
      {
        name: "GA4 - Begin Checkout",
        type: "gaawe",
        config: buildGa4EventTagConfig("begin_checkout", measurementId, [
          ["currency", "{{DLV - Ecommerce Currency}}"],
          ["value", "{{JS - Ecommerce Value (Number)}}"],
          ["items", "{{DLV - Ecommerce Items}}"],
        ]),
        triggerEvent: "begin_checkout",
        consentType: "analytics_storage",
        note: requiredNote,
      },
      {
        name: "GA4 - Purchase",
        type: "gaawe",
        config: buildGa4EventTagConfig("purchase", measurementId, [
          ["transaction_id", "{{DLV - Transaction ID}}"],
          ["value", "{{JS - Ecommerce Value (Number)}}"],
          ["currency", "{{DLV - Ecommerce Currency}}"],
          ["tax", "{{JS - Ecommerce Tax (Number)}}"],
          ["shipping", "{{JS - Ecommerce Shipping (Number)}}"],
          ["items", "{{DLV - Ecommerce Items}}"],
        ]),
        triggerEvent: "purchase",
        consentType: "analytics_storage",
        note: requiredNote,
      },
    ];
  },
};
