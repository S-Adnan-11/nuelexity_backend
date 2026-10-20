import { isIP } from "node:net";
import type { Request } from "express";
import type { Config } from "./config.js";
import { AppError } from "./errors.js";

export function clientIp(req: Request, config: Config): string {
  if (config.clientIpMode !== "render") return req.ip || req.socket.remoteAddress || "unknown";
  // Only opt in on Render's managed public ingress, which passes through
  // Cloudflare. Never use XFF position/hop guesses or fall back on another header.
  const value = req.get("CF-Connecting-IP") || "";
  if (!isIP(value))
    throw new AppError(503, "CLIENT_IP_UNAVAILABLE", "The service's network configuration is unavailable.");
  return value.toLowerCase();
}
