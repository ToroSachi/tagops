import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest, type IncomingMessage, type RequestOptions } from "node:http";
import { request as httpsRequest } from "node:https";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { postWebhook } from "../lib/webhook-transport.js";

vi.mock("node:dns/promises", () => ({ lookup: vi.fn() }));
vi.mock("node:http", () => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ request: vi.fn() }));

const url = "https://webhook.example.invalid/hooks/fixture";
const publicAnswer = { address: "8.8.8.8", family: 4 };
const lookupAll = vi.mocked(
  lookup as (hostname: string, options: { all: true }) => Promise<LookupAddress[]>,
);

describe("webhook transport destination policy", () => {
  beforeEach(() => vi.resetAllMocks());

  it.each([
    { address: "127.0.0.1", family: 4 },
    { address: "10.0.0.1", family: 4 },
    { address: "169.254.0.1", family: 4 },
    { address: "fc00::1", family: 6 },
    { address: "::ffff:127.0.0.1", family: 6 },
  ])("refuses non-public DNS answers without opening a connection", async (blockedAnswer) => {
    lookupAll.mockResolvedValue([publicAnswer, blockedAnswer]);
    await expect(postWebhook(url, "{}")).rejects.toThrow("only to public addresses");
    expect(lookup).toHaveBeenCalledOnce();
    expect(httpsRequest).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("refuses a non-public literal without using DNS", async () => {
    await expect(postWebhook("http://127.0.0.1/", "{}")).rejects.toThrow(
      "only to public addresses",
    );
    expect(lookup).not.toHaveBeenCalled();
    expect(httpRequest).not.toHaveBeenCalled();
  });

  it("fails closed when there are no DNS answers", async () => {
    lookupAll.mockResolvedValue([]);
    await expect(postWebhook(url, "{}")).rejects.toThrow("only to public addresses");
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("does not pass resolver details into the result", async () => {
    lookupAll.mockRejectedValue(new Error("resolver details"));
    await expect(postWebhook(url, "{}")).rejects.toThrow("Webhook hostname could not be resolved.");
    expect(httpsRequest).not.toHaveBeenCalled();
  });

  it("pins validated addresses and keeps the original TLS destination", async () => {
    const answers = [publicAnswer, { address: "2606:4700:4700::1111", family: 6 }];
    lookupAll.mockResolvedValue(answers);
    const resolveAddress = vi.fn();
    const response = { statusCode: 204, destroy: vi.fn() };
    const outgoing = { once: vi.fn(), end: vi.fn() };
    vi.mocked(httpsRequest).mockImplementation((destination, options, handler) => {
      expect(String(destination)).toBe(url);
      const settings = options as RequestOptions;
      expect(settings.agent).toBe(false);
      settings.lookup?.("webhook.example.invalid", { all: true }, resolveAddress);
      expect(resolveAddress).toHaveBeenLastCalledWith(null, answers);
      settings.lookup?.("webhook.example.invalid", { family: 4 }, resolveAddress);
      expect(resolveAddress).toHaveBeenLastCalledWith(null, publicAnswer.address, 4);
      handler?.(response as unknown as IncomingMessage);
      return outgoing as unknown as ReturnType<typeof httpsRequest>;
    });

    await expect(postWebhook(url, "{}")).resolves.toBe(204);
    expect(lookup).toHaveBeenCalledExactlyOnceWith("webhook.example.invalid", { all: true });
    expect(outgoing.end).toHaveBeenCalledWith("{}");
    expect(response.destroy).toHaveBeenCalledOnce();
  });

  it("returns redirect status without making another request", async () => {
    lookupAll.mockResolvedValue([publicAnswer]);
    const response = { statusCode: 307, destroy: vi.fn() };
    const outgoing = { once: vi.fn(), end: vi.fn() };
    vi.mocked(httpsRequest).mockImplementation((_destination, _options, handler) => {
      handler?.(response as unknown as IncomingMessage);
      return outgoing as unknown as ReturnType<typeof httpsRequest>;
    });

    await expect(postWebhook(url, "{}")).resolves.toBe(307);
    expect(lookup).toHaveBeenCalledOnce();
    expect(httpsRequest).toHaveBeenCalledOnce();
    expect(httpRequest).not.toHaveBeenCalled();
  });
});
