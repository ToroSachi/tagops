/**
 * Microsoft / Bing UET template
 */
import type { IntegrationTemplate } from "./types.js";
import { jsStringLiteral } from "./types.js";

export const bingUet: IntegrationTemplate = {
  id: "bing-uet",
  version: "1.0.0",
  name: "Microsoft / Bing UET",
  description: "Microsoft UET base tag with purchase revenue tracking",
  vendor: "Microsoft",
  category: "advertising",
  requiredInputs: [
    {
      key: "pixelId",
      name: "UET Tag ID",
      description: "Your Microsoft Advertising UET tag ID",
      example: "12345678",
      validator: "pixelId",
    },
  ],
  tags: (inputs) => {
    const tagIdLiteral = jsStringLiteral(inputs.pixelId);

    return [
      {
        name: "Bing – UET Base",
        type: "html",
        html: `<script>
(function(w,d,t,r,u){
  var f,n,i;
  w[u]=w[u]||[];
  f=function(){
    var o={ti:${tagIdLiteral}};
    o.q=w[u];
    w[u]=new UET(o);
    w[u].push("pageLoad");
  };
  n=d.createElement(t);
  n.src=r;
  n.async=1;
  n.onload=n.onreadystatechange=function(){
    var s=this.readyState;
    if (!s || s === "loaded" || s === "complete") {
      f();
      n.onload=n.onreadystatechange=null;
    }
  };
  i=d.getElementsByTagName(t)[0];
  i.parentNode.insertBefore(n,i);
})(window,document,"script","https://bat.bing.com/bat.js","uetq");
</script>`,
        triggerEvent: "all_pages",
        consentType: "ad_storage",
      },
      {
        name: "Bing – Purchase",
        type: "html",
        html: `<script>
window.uetq = window.uetq || [];
window.uetq.push("event", "purchase", {
  revenue_value: Number({{JS - Ecommerce Value (Number)}}),
  currency: "{{DLV - Ecommerce Currency}}",
  ecomm_prodid: {{DLV - Content IDs}},
  transaction_id: "{{DLV - Transaction ID}}"
});
</script>`,
        triggerEvent: "purchase",
        consentType: "ad_storage",
      },
    ];
  },
};
