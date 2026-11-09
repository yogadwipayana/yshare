import net from "node:net";
import os from "node:os";
import type { IncomingHttpHeaders } from "node:http";

const privateRanges = new net.BlockList();
privateRanges.addSubnet("127.0.0.0", 8, "ipv4"); // loopback
privateRanges.addSubnet("10.0.0.0", 8, "ipv4");
privateRanges.addSubnet("172.16.0.0", 12, "ipv4");
privateRanges.addSubnet("192.168.0.0", 16, "ipv4");
privateRanges.addSubnet("169.254.0.0", 16, "ipv4"); // link-local
privateRanges.addAddress("::1", "ipv6");
privateRanges.addSubnet("fc00::", 7, "ipv6"); // unique local
privateRanges.addSubnet("fe80::", 10, "ipv6"); // link-local

/** Strips IPv6 zone ids and the IPv4-mapped prefix (`::ffff:192.168.1.5` → `192.168.1.5`). */
export function normalizeIp(ip: string | undefined): string {
  if (!ip) return "";
  let value = ip.trim();
  const zone = value.indexOf("%");
  if (zone !== -1) value = value.slice(0, zone);
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(value);
  if (mapped) value = mapped[1];
  return value;
}

export function isPrivateIp(ip: string | undefined): boolean {
  const value = normalizeIp(ip);
  const family = net.isIP(value);
  if (family === 0) return false;
  return privateRanges.check(value, family === 4 ? "ipv4" : "ipv6");
}

export type LanAddress = { address: string; interface: string };

/** IPv4 addresses of this machine that other devices on the LAN can reach. */
export function getLanAddresses(): LanAddress[] {
  const result: LanAddress[] = [];
  for (const [name, entries] of Object.entries(os.networkInterfaces())) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue; // no DHCP lease, unreachable
      // VPN ranges like Tailscale (100.64.0.0/10) aren't LAN and are rejected by lan_only anyway.
      if (!isPrivateIp(entry.address)) continue;
      result.push({ address: entry.address, interface: name });
    }
  }
  // Home Wi-Fi is almost always 192.168.x.x; virtual adapters (WSL, Hyper-V, VPN) tend to be 172.x/10.x.
  const rank = (ip: string) => (ip.startsWith("192.168.") ? 0 : ip.startsWith("10.") ? 1 : 2);
  return result.sort((a, b) => rank(a.address) - rank(b.address));
}

function hostnameFromHostHeader(host: string): string {
  const value = host.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end === -1 ? "" : value.slice(1, end);
  }
  return value.split(":")[0].replace(/\.$/, "");
}

/**
 * Blocks DNS rebinding: a malicious site can point its own domain at a LAN IP, but the browser
 * still sends that domain in the Host header. Only IP literals, localhost and this machine's own
 * hostname are accepted.
 */
export function isAllowedHost(host: string | undefined, extraHosts: string[] = []): boolean {
  if (!host) return false;
  const hostname = hostnameFromHostHeader(host);
  if (!hostname) return false;
  if (net.isIP(hostname) !== 0) return true;
  if (hostname === "localhost") return true;

  const machine = os.hostname().toLowerCase();
  const machineNames = [machine, `${machine}.local`, `${machine}.lan`, `${machine}.home`];
  return machineNames.includes(hostname) || extraHosts.includes(hostname);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF guard for state-changing requests. Browsers always send `Origin` (and usually
 * `Sec-Fetch-Site`) on cross-site POST/PUT, so a mismatch means another website is trying to
 * use the visitor's browser to talk to yshare. Non-browser clients send neither and still need a
 * valid session cookie.
 */
export function isSameOriginRequest(method: string | undefined, headers: IncomingHttpHeaders): boolean {
  if (SAFE_METHODS.has((method ?? "GET").toUpperCase())) return true;

  const site = headers["sec-fetch-site"];
  if (typeof site === "string" && site !== "same-origin" && site !== "none") return false;

  const origin = headers.origin;
  if (origin === undefined) return true;
  if (origin === "null") return false;
  try {
    return new URL(origin).host.toLowerCase() === (headers.host ?? "").toLowerCase();
  } catch {
    return false;
  }
}
