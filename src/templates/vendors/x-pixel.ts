/**
 * X Pixel (Twitter/X) template
 */
import type { IntegrationTemplate } from "./types.js";
import { jsStringLiteral } from "./types.js";

export const xPixel: IntegrationTemplate = {
  id: "x-pixel",
  version: "1.0.0",
  name: "X Pixel (Twitter/X)",
  description: "X pixel base tag with PageView, ViewContent, and Purchase events",
  vendor: "X",
  category: "social",
  requiredInputs: [
    {
      key: "pixelId",
      name: "X Pixel ID",
      description: "Your X Ads pixel ID",
      example: "o9x8y",
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    const pixelIdLiteral = jsStringLiteral(inputs.pixelId);

    return [
      {
        name: "X – Base Pixel + PageView",
        type: "html",
        html: `<script>
!function(e,t,n,s,u,a){e.twq||(s=e.twq=function(){s.exe?s.exe.apply(s,arguments):s.queue.push(arguments);},
s.version='1.1',s.queue=[],u=t.createElement(n),u.async=!0,u.src='https://static.ads-twitter.com/uwt.js',
a=t.getElementsByTagName(n)[0],a.parentNode.insertBefore(u,a))}(window,document,'script');
twq('config', ${pixelIdLiteral});
twq('track', 'PageView');
</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
      },
      {
        name: "X – ViewContent",
        type: "html",
        html: `<script>
(function() {
  if (typeof twq !== "function") return;
  twq("track", "ViewContent", {
    value: Number({{JS - Ecommerce Value (Number)}}),
    currency: "{{DLV - Ecommerce Currency}}",
    contents: {{JS - Meta Contents}}
  });
})();
</script>`,
        triggerEvent: "view_item",
        consentType: "ad_storage",
      },
      {
        name: "X – Purchase",
        type: "html",
        html: `<script>
(function() {
  if (typeof twq !== "function") return;
  twq("track", "Purchase", {
    value: Number({{JS - Ecommerce Value (Number)}}),
    currency: "{{DLV - Ecommerce Currency}}",
    contents: {{JS - Meta Contents}},
    transaction_id: "{{DLV - Transaction ID}}"
  });
})();
</script>`,
        triggerEvent: "purchase",
        consentType: "ad_storage",
      },
    ];
  },
};
