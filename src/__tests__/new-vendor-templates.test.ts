/**
 * Tests for the new v0.1 vendor templates:
 *   Microsoft Clarity, Hotjar, Mixpanel, PostHog, HubSpot, Intercom,
 *   Yandex Metrica, and Meta Pixel Advanced.
 *
 * These are light assertions — shape, required inputs, interpolation.
 * Deeper correctness is validated by install / preview / validate flows.
 */
import { describe, it, expect } from "vitest";
import {
  microsoftClarity,
  hotjar,
  mixpanel,
  posthog,
  hubspot,
  intercom,
  yandexMetrica,
  metaPixelAdvanced,
} from "../templates/vendors/index.js";
import type { IntegrationTemplate } from "../templates/vendors/index.js";

function assertBasics(t: IntegrationTemplate) {
  expect(t.id).toMatch(/^[a-z0-9-]+$/);
  expect(t.name).toBeTruthy();
  expect(t.description).toBeTruthy();
  expect(t.vendor).toBeTruthy();
  expect(t.version).toBeTruthy();
  expect(t.requiredInputs.length).toBeGreaterThan(0);
}

describe("new vendor templates — shape and interpolation", () => {
  it("Microsoft Clarity: single pixel with interpolated project ID", () => {
    assertBasics(microsoftClarity);
    const tags = microsoftClarity.tags({ pixelId: "abc123xyz" });
    expect(tags).toHaveLength(1);
    expect(tags[0].html).toContain("abc123xyz");
    expect(tags[0].html).toContain("clarity.ms");
    expect(tags[0].consentType).toBe("analytics_storage");
  });

  it("Hotjar: single snippet with interpolated site ID", () => {
    assertBasics(hotjar);
    const tags = hotjar.tags({ pixelId: "9999999" });
    expect(tags).toHaveLength(1);
    expect(tags[0].html).toContain("hjid:9999999");
    expect(tags[0].html).toContain("static.hotjar.com");
  });

  it("Mixpanel: token passed into init()", () => {
    assertBasics(mixpanel);
    const tags = mixpanel.tags({ pixelId: "tok_abc" });
    expect(tags[0].html).toContain(`mixpanel.init("tok_abc"`);
    expect(tags[0].html).toContain("cdn.mxpnl.com");
  });

  it("PostHog: API key passed into init()", () => {
    assertBasics(posthog);
    const tags = posthog.tags({ pixelId: "phc_abc" });
    expect(tags[0].html).toContain(`posthog.init("phc_abc"`);
    expect(tags[0].html).toContain("us.i.posthog.com");
  });

  it("HubSpot: portal ID in src URL", () => {
    assertBasics(hubspot);
    const tags = hubspot.tags({ pixelId: "12345678" });
    expect(tags[0].html).toContain("12345678.js");
    expect(tags[0].html).toContain("hs-scripts.com");
  });

  it("Intercom: app_id interpolated into both settings and script src", () => {
    assertBasics(intercom);
    const tags = intercom.tags({ pixelId: "abc12xyz" });
    expect(tags[0].html).toContain(`app_id: "abc12xyz"`);
    expect(tags[0].html).toContain("widget.intercom.io/widget/abc12xyz");
  });

  it("Yandex Metrica: counter ID in ym() init + noscript pixel", () => {
    assertBasics(yandexMetrica);
    const tags = yandexMetrica.tags({ pixelId: "12345678" });
    expect(tags[0].html).toContain('ym(12345678, "init"');
    expect(tags[0].html).toContain("mc.yandex.ru/watch/12345678");
    expect(tags[0].html).toContain("webvisor:true");
  });

  it("Meta Pixel Advanced: includes consent init, advanced matching, and all funnel events", () => {
    assertBasics(metaPixelAdvanced);
    const tags = metaPixelAdvanced.tags({ pixelId: "1234567890" });

    // Base tag with consent + advanced matching
    const base = tags.find((t) => t.name.includes("Base Library"));
    expect(base).toBeDefined();
    expect(base!.html).toContain("fbq('consent'");
    expect(base!.html).toContain("fbq('init', \"1234567890\"");
    expect(base!.html).toContain("em: {{DLV - User Data Email}}");
    expect(base!.triggerEvent).toBe("consent_initialization");

    // Every major standard event present
    const names = tags.map((t) => t.name);
    for (const event of [
      "PageView",
      "ViewContent",
      "AddToCart",
      "InitiateCheckout",
      "AddPaymentInfo",
      "Purchase",
      "Lead",
      "CompleteRegistration",
      "Subscribe",
      "StartTrial",
      "Search",
      "AddToWishlist",
      "Contact",
      "Schedule",
    ]) {
      expect(names.some((n) => n.endsWith(event))).toBe(true);
    }

    // All event tags carry the eventID for CAPI dedup
    const eventTags = tags.filter((t) => !t.name.includes("Base Library"));
    for (const t of eventTags) {
      expect(t.html).toContain("eventID:{{Event ID}}");
    }
  });
});
