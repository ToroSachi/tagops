import { describe, it, expect, vi } from "vitest";

// Mock out Puppeteer entirely so we don't spin up real browsers in unit tests
vi.mock("puppeteer", () => {
  return {
    default: {
      launch: vi.fn().mockResolvedValue({
        newPage: vi.fn().mockResolvedValue({
          evaluateOnNewDocument: vi.fn().mockResolvedValue(undefined),
          goto: vi.fn().mockResolvedValue(undefined),
          waitForSelector: vi.fn().mockResolvedValue(undefined),
          click: vi.fn().mockResolvedValue(undefined),
          evaluate: vi
            .fn()
            .mockResolvedValue([
              { event: "gtm.js" },
              { event: "purchase", transaction_id: "T12345", value: 50.0 },
            ]),
        }),
        close: vi.fn().mockResolvedValue(undefined),
      }),
    },
  };
});

describe("Data Layer E2E Tester", () => {
  it("exports testDataLayer and printDataLayerTestReport", async () => {
    const mod = await import("../tools/test-datalayer.js");
    expect(typeof mod.testDataLayer).toBe("function");
    expect(typeof mod.printDataLayerTestReport).toBe("function");
  });

  it("validates data layer pushed events against a schema", async () => {
    const { testDataLayer } = await import("../tools/test-datalayer.js");

    const purchaseSchema = {
      type: "object",
      properties: {
        event: { type: "string" },
        transaction_id: { type: "string" },
        value: { type: "number" },
      },
      required: ["event", "transaction_id", "value"],
    };

    const result = await testDataLayer({
      url: "https://example.com",
      schema: purchaseSchema,
      eventName: "purchase",
    });

    // Mock returns a valid purchase push
    expect(result.passed).toBe(true);
    expect(result.matchedEvents).toBe(1);
    expect(result.errors.length).toBe(0);
  });

  it("fails validation when schema rules are violated", async () => {
    const { testDataLayer } = await import("../tools/test-datalayer.js");

    // Require an extra property that the mock doesn't push
    const strictSchema = {
      type: "object",
      properties: {
        event: { type: "string" },
        currency: { type: "string" },
      },
      required: ["currency"],
    };

    const result = await testDataLayer({
      url: "https://example.com",
      schema: strictSchema,
      eventName: "purchase",
    });

    expect(result.passed).toBe(false);
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors[0].message).toContain("must have required property 'currency'");
  });
});
