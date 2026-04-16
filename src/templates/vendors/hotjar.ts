/**
 * Hotjar template
 *
 * Heatmaps, recordings, and funnels. Install requires a Site ID (hjid) and
 * snippet version (hjsv). Official docs:
 *   https://help.hotjar.com/hc/en-us/articles/115009336727
 */
import type { IntegrationTemplate } from "./types.js";

export const hotjar: IntegrationTemplate = {
  id: "hotjar",
  version: "1.0.0",
  name: "Hotjar",
  description:
    "Hotjar heatmaps + session recordings. Site-ID-keyed snippet, drops the standard Hotjar tracking code on every page.",
  vendor: "Hotjar",
  category: "analytics",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Hotjar Site ID",
      description: "Your Hotjar Site ID (found in Hotjar → Sites & Organizations)",
      example: "1234567",
    },
  ],
  tags: (inputs) => {
    const siteId = inputs.pixelId;
    return [
      {
        name: "Hotjar Tracking",
        type: "html",
        html: `<script>\n(function(h,o,t,j,a,r){h.hj=h.hj||function(){(h.hj.q=h.hj.q||[]).push(arguments)};h._hjSettings={hjid:${siteId},hjsv:6};a=o.getElementsByTagName('head')[0];r=o.createElement('script');r.async=1;r.src=t+h._hjSettings.hjid+j+h._hjSettings.hjsv;a.appendChild(r)})(window,document,'https://static.hotjar.com/c/hotjar-','.js?sv=');\n</script>`,
        triggerEvent: "all_pages",
        consentType: "analytics_storage",
      },
    ];
  },
};
