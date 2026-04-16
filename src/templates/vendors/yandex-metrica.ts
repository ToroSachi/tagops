/**
 * Yandex Metrica template
 *
 * Russian/CIS-market web analytics with heatmaps and session recording built in.
 * Required for any site targeting RU/BY/KZ audiences.
 * Official docs: https://yandex.com/support/metrica/code/counter-webvisor.html
 */
import type { IntegrationTemplate } from "./types.js";

export const yandexMetrica: IntegrationTemplate = {
  id: "yandex-metrica",
  version: "1.0.0",
  name: "Yandex Metrica",
  description:
    "Yandex Metrica counter with Webvisor (session recording), click map, and accurate-bounce-rate tracking.",
  vendor: "Yandex",
  category: "analytics",
  requiredInputs: [
    {
      key: "pixelId",
      name: "Yandex Metrica Counter ID",
      description: "Your Yandex Metrica counter ID (8-digit numeric from metrica.yandex.com)",
      example: "12345678",
    },
  ],
  tags: (inputs) => {
    const counterId = inputs.pixelId;
    return [
      {
        name: "Yandex Metrica",
        type: "html",
        html: `<script type="text/javascript">\n(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");\nym(${counterId}, "init", {clickmap:true, trackLinks:true, accurateTrackBounce:true, webvisor:true});\n</script>\n<noscript><div><img src="https://mc.yandex.ru/watch/${counterId}" style="position:absolute; left:-9999px;" alt="" /></div></noscript>`,
        triggerEvent: "all_pages",
        consentType: "analytics_storage",
      },
    ];
  },
};
