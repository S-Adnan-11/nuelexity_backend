import type { Request } from "express";
import { AppError } from "./lib/errors";
import type { Store } from "./lib/types";

export async function authenticate(
  req: Request,
  store: Store,
  required = false,
): Promise<string | null> {
  const header = req.headers.authorization;
  if (!header) {
    if (required) throw new AppError(401, "UNAUTHORIZED", "Sign in to access saved conversations.");
    return null;
  }
  // An invalid token must never quietly become a guest request 😹.
  const match = /^Bearer ([^\s]+)$/i.exec(header);
  if (!match || header.length > 8192)
    throw new AppError(401, "UNAUTHORIZED", "Send a valid Bearer token.");
  return store.verifyToken(match[1]!);
}
