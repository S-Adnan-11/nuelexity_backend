import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";

export const GUEST_SESSION_MS = 2 * 60 * 60 * 1000;
const claimsSchema = z
  .object({
    id: z.uuid(),
    ipHash: z.string().regex(/^[a-f0-9]{64}$/),
    issuedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nonnegative(),
  })
  .strict();
function signature(secret: string, payload: string) {
  return createHmac("sha256", secret).update(`guest-session:v1:${payload}`).digest();
}
export function issueGuestSession(secret: string, ipHash: string, now = Date.now()) {
  const claims = claimsSchema.parse({
    id: randomUUID(),
    ipHash,
    issuedAt: now,
    expiresAt: now + GUEST_SESSION_MS,
  });
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return {
    pass: `v1.${payload}.${signature(secret, payload).toString("base64url")}`,
    guestId: claims.id,
    expiresAt: claims.expiresAt,
  };
}
export function verifyGuestSession(secret: string, pass: string, ipHash: string, now = Date.now()) {
  // Browser flags are easy to fake sha. Only trust a signed, unexpired server pass.
  if (secret.length < 32 || pass.length > 1024) return null;
  const parts = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]{43})$/.exec(pass);
  if (!parts) return null;
  const expected = signature(secret, parts[1]!);
  const supplied = Buffer.from(parts[2]!, "base64url");
  if (supplied.length !== expected.length || !timingSafeEqual(expected, supplied)) return null;
  try {
    const parsed = claimsSchema.safeParse(
      JSON.parse(Buffer.from(parts[1]!, "base64url").toString()),
    );
    if (!parsed.success) return null;
    const claims = parsed.data;
    if (
      claims.ipHash !== ipHash ||
      claims.issuedAt > now ||
      claims.expiresAt <= now ||
      claims.expiresAt - claims.issuedAt !== GUEST_SESSION_MS
    )
      return null;
    return { guestId: claims.id, expiresAt: claims.expiresAt };
  } catch {
    return null;
  }
}
