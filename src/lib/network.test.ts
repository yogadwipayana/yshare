import os from "node:os";
import { describe, expect, it } from "vitest";
import { isAllowedHost, isPrivateIp, isSameOriginRequest, normalizeIp } from "./network";

describe("isPrivateIp", () => {
  it.each(["127.0.0.1", "10.1.2.3", "172.16.0.5", "172.31.255.255", "192.168.1.20", "::1", "fe80::1", "fd12::1", "::ffff:192.168.1.5"])(
    "allows %s",
    (ip) => expect(isPrivateIp(ip)).toBe(true),
  );

  it.each(["8.8.8.8", "172.32.0.1", "100.64.0.1", "1.1.1.1", "2001:4860::8888", "::ffff:8.8.8.8", "", "garbage", undefined])(
    "rejects %s",
    (ip) => expect(isPrivateIp(ip)).toBe(false),
  );

  it("normalizes mapped IPv4 and zone ids", () => {
    expect(normalizeIp("::ffff:10.0.0.1")).toBe("10.0.0.1");
    expect(normalizeIp("fe80::1%eth0")).toBe("fe80::1");
  });
});

describe("isAllowedHost", () => {
  it("allows IP literals, localhost and the machine name", () => {
    expect(isAllowedHost("192.168.1.10:8080")).toBe(true);
    expect(isAllowedHost("[::1]:8080")).toBe(true);
    expect(isAllowedHost("localhost:8080")).toBe(true);
    expect(isAllowedHost(`${os.hostname()}:8080`)).toBe(true);
    expect(isAllowedHost("pc-ku.lan", ["pc-ku.lan"])).toBe(true);
  });

  it("rejects other domains (DNS rebinding)", () => {
    expect(isAllowedHost("evil.example.com:8080")).toBe(false);
    expect(isAllowedHost("192.168.1.10.nip.io:8080")).toBe(false);
    expect(isAllowedHost(undefined)).toBe(false);
    expect(isAllowedHost("")).toBe(false);
  });
});

describe("isSameOriginRequest", () => {
  const host = "192.168.1.10:8080";

  it("always allows safe methods", () => {
    expect(isSameOriginRequest("GET", { host, origin: "https://evil.example" })).toBe(true);
  });

  it("allows same-origin writes", () => {
    expect(isSameOriginRequest("PUT", { host, origin: `http://${host}`, "sec-fetch-site": "same-origin" })).toBe(true);
    expect(isSameOriginRequest("POST", { host })).toBe(true); // curl, no browser headers
  });

  it("blocks cross-site writes", () => {
    expect(isSameOriginRequest("POST", { host, origin: "https://evil.example" })).toBe(false);
    expect(isSameOriginRequest("PUT", { host, "sec-fetch-site": "cross-site" })).toBe(false);
    expect(isSameOriginRequest("POST", { host, origin: "null" })).toBe(false);
    expect(isSameOriginRequest("POST", { host, origin: "http://192.168.1.10:9999" })).toBe(false);
  });
});
