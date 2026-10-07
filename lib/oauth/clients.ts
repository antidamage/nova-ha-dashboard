// Sole reader of the client registry (data/oauth/clients.json). Read on every
// call: the file is tiny, and a revoke must take effect without a restart.
import { readFile } from "fs/promises";
import { CLIENTS_PATH } from "./constants";
import { verifySecret } from "./secret-hash";

export type OAuthClient = {
  id: string;
  label?: string;
  secretHash: string;
  scopes: string[];
  createdAt?: string;
  revokedAt?: string;
};

// A well-formed hash nobody can match, so an unknown id costs the same scrypt run as a known one.
const DUMMY_HASH = `scrypt$${"0".repeat(32)}$${"0".repeat(128)}`;

export async function readClients(): Promise<OAuthClient[]> {
  try {
    const parsed = JSON.parse(await readFile(CLIENTS_PATH, "utf8")) as { clients?: unknown };
    if (!Array.isArray(parsed.clients)) {
      return [];
    }
    return parsed.clients.filter(
      (entry): entry is OAuthClient =>
        Boolean(entry) &&
        typeof (entry as OAuthClient).id === "string" &&
        typeof (entry as OAuthClient).secretHash === "string" &&
        Array.isArray((entry as OAuthClient).scopes),
    );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** The active (not revoked) client with this id, or null. */
export async function findActiveClient(id: string): Promise<OAuthClient | null> {
  const client = (await readClients()).find((entry) => entry.id === id);
  return client && !client.revokedAt ? client : null;
}

/**
 * A client whose id and secret both check out. The hash is verified even for an
 * unknown id, so response time does not reveal which ids are registered.
 */
export async function authenticateClient(id: string, secret: string): Promise<OAuthClient | null> {
  const client = await findActiveClient(id);
  const matched = verifySecret(secret, client?.secretHash ?? DUMMY_HASH);
  return client && matched ? client : null;
}
