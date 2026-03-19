import { describe, it, expect } from "vitest";

describe("CAPI Payload Validator", () => {
  it("exports validateCapiPayload and printCapiValidationReport", async () => {
    const mod = await import("../tools/validate-capi.js");
    expect(typeof mod.validateCapiPayload).toBe("function");
    expect(typeof mod.printCapiValidationReport).toBe("function");
  });

  it("validates a compliant Meta payload", async () => {
    const { validateCapiPayload } = await import("../tools/validate-capi.js");

    const validMetaPayload = {
      data: [
        {
          event_name: "Purchase",
          event_time: Math.floor(Date.now() / 1000) - 100,
          action_source: "website",
          event_id: "txn_12345",
          user_data: {
            em: "f660ab912ec121d1b1e928a0bb4bc61b15f5ad44d5efdc4e1c92a25e99b8e44a",
            client_ip_address: "192.168.1.1",
            client_user_agent: "Mozilla/5.0 ...",
            fbp: "fb.1.1610493864195.109765270",
            fbc: "fb.1.1610493864195.IwAR... ",
          },
          custom_data: {
            value: 142.52,
            currency: "USD",
          },
        },
      ],
    };

    const result = await validateCapiPayload({
      platform: "meta",
      payload: validMetaPayload,
    });

    expect(result.passed).toBe(true);
    // Warnings are allowed to pass (e.g., if array vs string etc. but here we provided single string which is fine per logic)
    expect(result.errors.filter((e) => e.severity === "error").length).toBe(0);
  });

  it("fails Meta payload lacking hashing", async () => {
    const { validateCapiPayload } = await import("../tools/validate-capi.js");

    const badMetaPayload = {
      data: [
        {
          event_name: "Lead",
          event_time: Math.floor(Date.now() / 1000) - 100,
          action_source: "website",
          event_id: "lead_1",
          user_data: {
            em: "john.doe@example.com", // UNHASHED!
          },
        },
      ],
    };

    const result = await validateCapiPayload({
      platform: "meta",
      payload: badMetaPayload,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.message.includes("SHA-256") && e.severity === "error")).toBe(
      true,
    );
  });

  it("validates a compliant TikTok payload", async () => {
    const { validateCapiPayload } = await import("../tools/validate-capi.js");

    const validTikTokPayload = {
      event: "CompletePayment",
      event_time: Math.floor(Date.now() / 1000) - 100,
      event_id: "tt_txn_123",
      user: {
        email: "f660ab912ec121d1b1e928a0bb4bc61b15f5ad44d5efdc4e1c92a25e99b8e44a",
        ttp: "...",
        ttclid: "...",
      },
    };

    // Note validator converts single objects to arrays internally
    const result = await validateCapiPayload({
      platform: "tiktok",
      payload: validTikTokPayload,
    });

    expect(result.passed).toBe(true);
  });

  it("fails TikTok payload with no event_id", async () => {
    const { validateCapiPayload } = await import("../tools/validate-capi.js");

    const badTikTokPayload = [
      {
        event: "AddToCart",
        event_time: Math.floor(Date.now() / 1000) - 100,
        user: {
          email: "f660ab912ec121d1b1e928a0bb4bc61b15f5ad44d5efdc4e1c92a25e99b8e44a",
          ttclid: "...",
        },
      },
    ];

    const result = await validateCapiPayload({
      platform: "tiktok",
      payload: badTikTokPayload,
    });

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.message.includes("event_id"))).toBe(true);
  });
});
