/**
 * Pinterest Tag template
 */
import type { IntegrationTemplate } from "./types.js";

export const pinterestTag: IntegrationTemplate = {
  id: "pinterest-tag",
  version: "1.0.0",
  name: "Pinterest Tag",
  description: "Pinterest conversion tracking: PageVisit, ViewCategory, AddToCart, Checkout",
  vendor: "Pinterest",
  category: "social",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Pinterest Tag ID",
      description: "Your Pinterest Tag ID",
      example: "1234567890",
    },
  ],
  tags: (inputs) => {
    const pid = inputs.pixelId;
    return [
      {
        name: "Pinterest – Base Tag",
        type: "html",
        html: `<script>!function(e){if(!window.pintrk){window.pintrk=function(){window.pintrk.queue.push(Array.prototype.slice.call(arguments))};var n=window.pintrk;n.queue=[],n.version="3.0";var t=document.createElement("script");t.async=!0,t.src=e;var r=document.getElementsByTagName("script")[0];r.parentNode.insertBefore(t,r)}}("https://s.pinimg.com/ct/core.js");pintrk('load','${pid}');pintrk('page');</script>`,
        triggerEvent: "page_view",
        consentType: "ad_storage",
      },
      {
        name: "Pinterest – ViewCategory",
        type: "html",
        html: `<script>pintrk('track','viewcategory');</script>`,
        triggerEvent: "view_item",
        consentType: "ad_storage",
      },
      {
        name: "Pinterest – AddToCart",
        type: "html",
        html: `<script>pintrk('track','addtocart',{value:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}});</script>`,
        triggerEvent: "add_to_cart",
        consentType: "ad_storage",
      },
      {
        name: "Pinterest – Checkout",
        type: "html",
        html: `<script>pintrk('track','checkout',{value:{{JS - Ecommerce Value (Number)}},currency:{{DLV - Ecommerce Currency}},order_id:{{DLV - Transaction ID}}});</script>`,
        triggerEvent: "purchase",
        consentType: "ad_storage",
      },
    ];
  },
};
