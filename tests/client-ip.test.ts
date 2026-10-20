import { expect, test } from "vitest";
import type { Request } from "express";
import { clientIp } from "../lib/client-ip.js";
import { readConfig } from "../lib/config.js";

test("Render ingress mode is explicit; forwarding headers never enable trust locally", () => {
  expect(() => readConfig({ CLIENT_IP_MODE: "render" })).toThrow("Render managed ingress");
  expect(() => readConfig({ CLIENT_IP_MODE: "render", RENDER: "true", TRUST_PROXY_HOPS: "1" })).toThrow();
  const req = { ip: "127.0.0.1", get: () => "203.0.113.9" } as unknown as Request;
  expect(clientIp(req, readConfig({}))).toBe("127.0.0.1");
});
test("managed Render ingress takes one valid Cloudflare IP, ignores XFF and fails closed", () => {
  const config = readConfig({ CLIENT_IP_MODE: "render", RENDER: "true" });
  const req = (value: string) => ({ get: (name: string) => name === "CF-Connecting-IP" ? value : "198.51.100.123" }) as Request;
  expect(clientIp(req("203.0.113.9"), config)).toBe("203.0.113.9");
  expect(clientIp(req("2001:DB8::1"), config)).toBe("2001:db8::1");
  for (const value of ["", "unknown", "203.0.113.9, 198.51.100.2", "203.0.113.9:123"])
    expect(() => clientIp(req(value), config)).toThrow("network configuration");
});
