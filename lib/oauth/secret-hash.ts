import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Format: scrypt$<salt hex>$<hash hex>. scripts/oauth-client.mjs writes the same
// format; lib/oauth/oauth.test.ts holds the two to each other.
const SCRYPT = { N: 16384, r: 8, p: 1 } as const;
const KEY_BYTES = 64;

export function hashSecret(secret: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(secret, salt, KEY_BYTES, SCRYPT);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export function verifySecret(secret: string, stored: string): boolean {
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== "scrypt" || !saltHex || !hashHex) {
    return false;
  }
  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEY_BYTES) {
    return false;
  }
  const actual = scryptSync(secret, Buffer.from(saltHex, "hex"), KEY_BYTES, SCRYPT);
  return timingSafeEqual(actual, expected);
}
