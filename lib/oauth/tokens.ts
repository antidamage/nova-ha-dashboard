import { createHash, createHmac, randomBytes, timingSafeEqual } from "crypto";
import { link, mkdir, readFile, unlink, writeFile } from "fs/promises";
import path from "path";
import { SIGNING_KEY_PATH, TOKEN_ISSUER, TOKEN_TTL_SECONDS } from "./constants";

export type TokenClaims = { iss: string; sub: string; scope: string; iat: number; exp: number; ver: string };

const MIN_KEY_LENGTH = 32;

let cachedKey: string | null = null;

/** Fingerprint of a client's current secret: rotating the secret changes it, which ends every token issued before. */
export function secretVersion(secretHash: string) {
  return createHash("sha256").update(secretHash).digest("hex").slice(0, 16);
}

function usable(key: string) {
  if (key.length < MIN_KEY_LENGTH) {
    throw new Error("OAuth signing key is missing or too short.");
  }
  return key;
}

/** Per-install signing key: env override, else a file created 0600 on first use. */
async function signingKey(): Promise<string> {
  const fromEnv = process.env.NOVA_OAUTH_SIGNING_KEY?.trim();
  if (fromEnv) {
    return usable(fromEnv);
  }
  if (cachedKey) {
    return cachedKey;
  }
  try {
    cachedKey = usable((await readFile(SIGNING_KEY_PATH, "utf8")).trim());
    return cachedKey;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }
  await mkdir(path.dirname(SIGNING_KEY_PATH), { recursive: true });
  const created = randomBytes(32).toString("hex");
  // Written whole to a private temp file, then hard-linked into place: the key
  // file either does not exist or holds a complete key, and of two first
  // requests racing, the loser (EEXIST) reads the winner's key.
  const temp = `${SIGNING_KEY_PATH}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  await writeFile(temp, `${created}\n`, { mode: 0o600 });
  try {
    await link(temp, SIGNING_KEY_PATH);
    cachedKey = created;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
      throw error;
    }
    cachedKey = usable((await readFile(SIGNING_KEY_PATH, "utf8")).trim());
  } finally {
    await unlink(temp).catch(() => undefined);
  }
  return cachedKey;
}

function sign(body: string, key: string) {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export async function issueToken(clientId: string, scopes: string[], version: string, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const claims: TokenClaims = {
    iss: TOKEN_ISSUER,
    sub: clientId,
    scope: scopes.join(" "),
    iat,
    exp: iat + TOKEN_TTL_SECONDS,
    ver: version,
  };
  const body = Buffer.from(JSON.stringify(claims)).toString("base64url");
  return { token: `${body}.${sign(body, await signingKey())}`, expiresIn: TOKEN_TTL_SECONDS };
}

export async function verifyToken(token: string, now = Date.now()): Promise<TokenClaims | null> {
  const [body, signature, extra] = token.split(".");
  if (!body || !signature || extra !== undefined) {
    return null;
  }
  const expected = Buffer.from(sign(body, await signingKey()));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    return null;
  }
  try {
    const claims = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as TokenClaims;
    const valid =
      claims.iss === TOKEN_ISSUER &&
      typeof claims.sub === "string" &&
      typeof claims.scope === "string" &&
      typeof claims.ver === "string" &&
      typeof claims.exp === "number" &&
      claims.exp > Math.floor(now / 1000);
    return valid ? claims : null;
  } catch {
    return null;
  }
}
