/**
 * Klaviyo Onsite Tracking template
 */
import type { IntegrationTemplate } from "./types.js";

export const klaviyo: IntegrationTemplate = {
  id: "klaviyo",
  version: "1.0.0",
  name: "Klaviyo Onsite Tracking",
  description:
    "Klaviyo JavaScript snippet for onsite tracking, identify calls, and marketing automation",
  vendor: "Klaviyo",
  category: "marketing",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Klaviyo Public API Key",
      description: "Your Klaviyo public API key (company_id)",
      example: "SFwUtB",
    },
  ],
  tags: (inputs) => {
    const apiKey = inputs.pixelId;
    return [
      {
        name: "Klaviyo Tracking",
        type: "html",
        html: `<script async type='text/javascript' src='https://static.klaviyo.com/onsite/js/${apiKey}/klaviyo.js?company_id=${apiKey}'></script>\n<script type="text/javascript">\n!function(){if(!window.klaviyo){window._klOnsite=window._klOnsite||[];try{window.klaviyo=new Proxy({},{get:function(n,i){return"push"===i?function(){var n;(n=window._klOnsite).push.apply(n,arguments)}:function(){for(var n=arguments.length,o=new Array(n),w=0;w<n;w++)o[w]=arguments[w];var t="function"==typeof o[o.length-1]?o.pop():void 0,e=new Promise((function(n){window._klOnsite.push([i].concat(o,[function(i){t&&t(i),n(i)}]))}));return e}}})}catch(n){window.klaviyo=window.klaviyo||[],window.klaviyo.push=function(){var n;(n=window._klOnsite).push.apply(n,arguments)}}}}();\n</script>`,
        triggerEvent: "all_pages",
        consentType: "analytics_storage",
      },
    ];
  },
};
