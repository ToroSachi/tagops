/**
 * Meta Pixel (Facebook) template
 */
import type { IntegrationTemplate } from "./types.js";
import { jsStringLiteral } from "./types.js";

export const metaPixel: IntegrationTemplate = {
  id: "meta-pixel",
  version: "1.0.0",
  name: "Meta Pixel (Facebook)",
  description:
    "Meta Pixel with PageView, ViewContent, AddToCart, InitiateCheckout, Purchase + event ID dedup",
  vendor: "Meta",
  category: "advertising",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Meta Pixel ID",
      description: "Your Meta (Facebook) Pixel ID",
      example: "1234567890",
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    const pixelIdLiteral = jsStringLiteral(inputs.pixelId);
    return [
      {
        name: "Meta – PageView",
        type: "html",
        html: `<script>!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');fbq('init',${pixelIdLiteral});fbq('track','PageView');</script>`,
        triggerEvent: "page_view",
        consentType: "ad_storage",
      },
      {
        name: "Meta – ViewContent",
        type: "html",
        html: `<script>fbq('track','ViewContent',{content_ids:{{DLV - Content IDs}},content_type:'product',value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}},{eventID:{{Event ID}}});</script>`,
        triggerEvent: "view_item",
        consentType: "ad_storage",
      },
      {
        name: "Meta – AddToCart",
        type: "html",
        html: `<script>fbq('track','AddToCart',{content_ids:{{DLV - Content IDs}},content_type:'product',value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}},{eventID:{{Event ID}}});</script>`,
        triggerEvent: "add_to_cart",
        consentType: "ad_storage",
      },
      {
        name: "Meta – InitiateCheckout",
        type: "html",
        html: `<script>fbq('track','InitiateCheckout',{value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}},{eventID:{{Event ID}}});</script>`,
        triggerEvent: "begin_checkout",
        consentType: "ad_storage",
      },
      {
        name: "Meta – Purchase",
        type: "html",
        html: `<script>fbq('track','Purchase',{value:{{JS - Ecommerce Value (Number)}},currency:{{DLV - Ecommerce Currency}},content_ids:{{DLV - Content IDs}},content_type:'product'},{eventID:{{Event ID}}});</script>`,
        triggerEvent: "purchase",
        consentType: "ad_storage",
      },
    ];
  },
};
