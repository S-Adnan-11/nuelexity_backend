import { expect, test } from "bun:test";
import { GUEST_SESSION_MS, issueGuestSession, verifyGuestSession } from "../lib/guest-session";

const secret = "test-only-secret".repeat(4),
  ip = "a".repeat(64),
  now = 10000;
test("guest verification survives refresh but expires after two hours without renewal", () => {
  const session = issueGuestSession(secret, ip, now);
  expect(verifyGuestSession(secret, session.pass, ip, now + 1)).toEqual({
    guestId: session.guestId,
    expiresAt: now + GUEST_SESSION_MS,
  });
  expect(verifyGuestSession(secret, session.pass, ip, now + GUEST_SESSION_MS - 1)).not.toBeNull();
  expect(verifyGuestSession(secret, session.pass, ip, now + GUEST_SESSION_MS)).toBeNull();
});
test("forged, tampered, oversized, cross-IP, future, or old-secret passes fail closed", () => {
  const session = issueGuestSession(secret, ip, now);
  const parts = session.pass.split(".");
  const claims = JSON.parse(Buffer.from(parts[1]!, "base64url").toString());
  claims.expiresAt += GUEST_SESSION_MS;
  const tampered = `v1.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.${parts[2]}`;
  for (const pass of ["true", "v1.not-json.bad-signature", "x".repeat(2000), tampered])
    expect(verifyGuestSession(secret, pass, ip, now)).toBeNull();
  expect(verifyGuestSession(secret, session.pass, "b".repeat(64), now)).toBeNull();
  expect(verifyGuestSession(secret, session.pass, ip, now - 1)).toBeNull();
  expect(verifyGuestSession(secret + "rotated", session.pass, ip, now)).toBeNull();
  expect(verifyGuestSession("", session.pass, ip, now)).toBeNull();
});
