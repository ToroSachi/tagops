/**
 * PostHog template
 *
 * Open-source product analytics. Supports both cloud and self-hosted instances.
 * Official docs: https://posthog.com/docs/libraries/js
 */
import type { IntegrationTemplate } from "./types.js";

export const posthog: IntegrationTemplate = {
  id: "posthog",
  version: "1.0.0",
  name: "PostHog",
  description:
    "PostHog product analytics + session replay JS snippet. Project-API-key keyed; defaults to PostHog Cloud US.",
  vendor: "PostHog",
  category: "analytics",
  requiredInputs: [
    {
      key: "pixelId",
      name: "PostHog Project API Key",
      description: "Your PostHog project API key (Project Settings → API Keys → Project API Key)",
      example: "phc_abc123xyz",
    },
  ],
  tags: (inputs) => {
    const apiKey = inputs.pixelId;
    return [
      {
        name: "PostHog Tracking",
        type: "html",
        html: `<script>\n!function(t,e){var o,n,p,r;e.__SV||(window.posthog=e,e._i=[],e.init=function(i,s,a){function g(t,e){var o=e.split(".");2==o.length&&(t=t[o[0]],e=o[1]),t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}}(p=t.createElement("script")).type="text/javascript",p.async=!0,p.src=s.api_host+"/static/array.js",(r=t.getElementsByTagName("script")[0]).parentNode.insertBefore(p,r);var u=e;for(void 0!==a?u=e[a]=[]:a="posthog",u.people=u.people||[],u.toString=function(t){var e="posthog";return"posthog"!==a&&(e+="."+a),t||(e+=" (stub)"),e},u.people.toString=function(){return u.toString(1)+".people (stub)"},o="capture identify alias people.set people.set_once set_config register register_once unregister opt_out_capturing has_opted_out_capturing opt_in_capturing reset isFeatureEnabled onFeatureFlags getFeatureFlag getFeatureFlagPayload reloadFeatureFlags group updateEarlyAccessFeatureEnrollment getEarlyAccessFeatures getActiveMatchingSurveys getSurveys getNextSurveyStep onSessionId".split(" "),n=0;n<o.length;n++)g(u,o[n]);e._i.push([i,s,a])},e.__SV=1)}(document,window.posthog||[]);\nposthog.init("${apiKey}", {api_host: "https://us.i.posthog.com", person_profiles: "identified_only"});\n</script>`,
        triggerEvent: "all_pages",
        consentType: "analytics_storage",
        note: "Uses PostHog Cloud US by default. To use EU cloud, change api_host to https://eu.i.posthog.com. For self-hosted, change api_host to your instance URL.",
      },
    ];
  },
};
