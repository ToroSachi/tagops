/**
 * Microsoft Clarity template
 *
 * Free heatmaps + session recordings from Microsoft. Install is a single
 * snippet keyed by a project ID. Official docs:
 *   https://learn.microsoft.com/en-us/clarity/setup-and-installation/clarity-setup
 */
import type { IntegrationTemplate } from "./types.js";

export const microsoftClarity: IntegrationTemplate = {
  id: "microsoft-clarity",
  version: "1.0.0",
  name: "Microsoft Clarity",
  description:
    "Free session recordings + heatmaps (Microsoft Clarity). Single snippet install keyed by project ID.",
  vendor: "Microsoft",
  category: "analytics",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Clarity Project ID",
      description: "Your Clarity Project ID (find it at clarity.microsoft.com → Settings → Setup)",
      example: "abc123xyz",
    },
  ],
  tags: (inputs) => {
    const projectId = inputs.pixelId;
    return [
      {
        name: "Microsoft Clarity",
        type: "html",
        html: `<script type="text/javascript">\n(function(c,l,a,r,i,t,y){c[a]=c[a]||function(){(c[a].q=c[a].q||[]).push(arguments)};t=l.createElement(r);t.async=1;t.src="https://www.clarity.ms/tag/"+i;y=l.getElementsByTagName(r)[0];y.parentNode.insertBefore(t,y)})(window,document,"clarity","script","${projectId}");\n</script>`,
        triggerEvent: "all_pages",
        consentType: "analytics_storage",
      },
    ];
  },
};
