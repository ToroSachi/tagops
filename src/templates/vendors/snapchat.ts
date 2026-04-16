/**
 * Snapchat Pixel template
 */
import type { IntegrationTemplate } from "./types.js";

export const snapchatPixel: IntegrationTemplate = {
  id: "snapchat-pixel",
  version: "1.0.0",
  name: "Snapchat Pixel",
  description: "Snapchat conversion tracking: PAGE_VIEW, VIEW_CONTENT, ADD_CART, PURCHASE",
  vendor: "Snapchat",
  category: "social",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Snap Pixel ID",
      description: "Your Snapchat Pixel ID",
      example: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    },
  ],
  tags: (inputs) => {
    const pid = inputs.pixelId;
    return [
      {
        name: "Snapchat – Base + PageView",
        type: "html",
        html: `<script>(function(e,t,n){if(e.snaptr)return;var a=e.snaptr=function(){a.handleRequest?a.handleRequest.apply(a,arguments):a.queue.push(arguments)};a.queue=[];var s='script';r=t.createElement(s);r.async=!0;r.src=n;var u=t.getElementsByTagName(s)[0];u.parentNode.insertBefore(r,u);})(window,document,'https://sc-static.net/scevent.min.js');snaptr('init','${pid}');snaptr('track','PAGE_VIEW');</script>`,
        triggerEvent: "page_view",
        consentType: "ad_storage",
      },
      {
        name: "Snapchat – VIEW_CONTENT",
        type: "html",
        html: `<script>snaptr('track','VIEW_CONTENT',{price:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}});</script>`,
        triggerEvent: "view_item",
        consentType: "ad_storage",
      },
      {
        name: "Snapchat – ADD_CART",
        type: "html",
        html: `<script>snaptr('track','ADD_CART',{price:{{DLV - Ecommerce Value}},currency:{{DLV - Ecommerce Currency}}});</script>`,
        triggerEvent: "add_to_cart",
        consentType: "ad_storage",
      },
      {
        name: "Snapchat – PURCHASE",
        type: "html",
        html: `<script>snaptr('track','PURCHASE',{price:{{JS - Ecommerce Value (Number)}},currency:{{DLV - Ecommerce Currency}},transaction_id:{{DLV - Transaction ID}}});</script>`,
        triggerEvent: "purchase",
        consentType: "ad_storage",
      },
    ];
  },
};
