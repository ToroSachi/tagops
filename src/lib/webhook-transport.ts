import type { LookupAddress } from "node:dns";
import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";

// Deny local, reserved, documentation and non-unicast address space.
const nonPublic = new BlockList();
const ipv4Subnets = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const;
for (const [address, prefix] of ipv4Subnets) nonPublic.addSubnet(address, prefix, "ipv4");

const ipv6Global = new BlockList();
ipv6Global.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const) {
  nonPublic.addSubnet(address, prefix, "ipv6");
}

function isPublicAddress({ address, family }: LookupAddress): boolean {
  if (isIP(address) !== family) return false;
  if (family === 4) return !nonPublic.check(address, "ipv4");
  return family === 6 && ipv6Global.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
}

function pinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    const family = options.family === "IPv4" ? 4 : options.family === "IPv6" ? 6 : options.family;
    const candidates = family ? addresses.filter((answer) => answer.family === family) : addresses;
    const first = candidates[0];
    if (!first)
      return callback(new Error("No validated webhook address for the requested family."), "");
    if (options.all) return callback(null, candidates);
    callback(null, first.address, first.family);
  };
}

async function resolveAddresses(hostname: string): Promise<LookupAddress[]> {
  const family = isIP(hostname);
  let addresses: LookupAddress[];
  try {
    addresses = family ? [{ address: hostname, family }] : await lookup(hostname, { all: true });
  } catch {
    throw new Error("Webhook hostname could not be resolved.");
  }
  if (!addresses.length || !addresses.every(isPublicAddress)) {
    throw new Error("Webhook destination must resolve only to public addresses.");
  }
  return addresses;
}

/** Use the validated DNS answers for the connection and never follow a redirect. */
export async function postWebhook(destination: string, body: string): Promise<number> {
  const url = new URL(destination);
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
    throw new Error("Webhook destination must be an HTTP(S) URL without credentials.");
  }

  const addresses = await resolveAddresses(url.hostname.replace(/^\[|\]$/g, ""));
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  return new Promise((resolve, reject) => {
    const fail = () => reject(new Error("Webhook request failed."));
    const outgoing = request(
      url,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
        lookup: pinnedLookup(addresses),
        agent: false,
        signal: AbortSignal.timeout(10_000),
      },
      (response) => {
        const status = response.statusCode;
        response.destroy();
        if (status === undefined) return fail();
        resolve(status);
      },
    );
    outgoing.once("error", fail);
    outgoing.end(body);
  });
}
