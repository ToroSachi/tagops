/**
 * Intercom Messenger template
 *
 * Intercom chat + product tours. Workspace-ID-keyed. For authenticated
 * identification, Intercom's HMAC-based Identity Verification can be layered
 * on top (requires server-side HMAC — not exposed in a declarative template).
 * Official docs: https://developers.intercom.com/installing-intercom/web/installation
 */
import type { IntegrationTemplate } from "./types.js";

export const intercom: IntegrationTemplate = {
  id: "intercom",
  version: "1.0.0",
  name: "Intercom Messenger",
  description:
    "Intercom chat widget + product tours. Workspace-ID-keyed; supports anonymous visitors out of the box.",
  vendor: "Intercom",
  category: "marketing",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Intercom Workspace ID (app_id)",
      description:
        "Your Intercom Workspace ID — visible in your Intercom dashboard URL or Settings → Installation",
      example: "abc12xyz",
    },
  ],
  tags: (inputs) => {
    const appId = inputs.pixelId;
    return [
      {
        name: "Intercom Messenger",
        type: "html",
        html: `<script>\nwindow.intercomSettings = {api_base: "https://api-iam.intercom.io", app_id: "${appId}"};\n(function(){var w=window;var ic=w.Intercom;if(typeof ic==="function"){ic('reattach_activator');ic('update',w.intercomSettings);}else{var d=document;var i=function(){i.c(arguments);};i.q=[];i.c=function(args){i.q.push(args);};w.Intercom=i;var l=function(){var s=d.createElement('script');s.type='text/javascript';s.async=true;s.src='https://widget.intercom.io/widget/${appId}';var x=d.getElementsByTagName('script')[0];x.parentNode.insertBefore(s,x);};if(document.readyState==='complete'){l();}else if(w.attachEvent){w.attachEvent('onload',l);}else{w.addEventListener('load',l,false);}}})();\n</script>`,
        triggerEvent: "all_pages",
        consentType: "analytics_storage",
        note: "For authenticated users, add Intercom Identity Verification (HMAC) — that requires a server-side secret and is NOT safe to inline in GTM.",
      },
    ];
  },
};
