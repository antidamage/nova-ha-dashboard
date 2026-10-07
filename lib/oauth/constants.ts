import path from "path";

// Spec: specs/update-force-endpoint.md. The registry and signing key sit in the
// bind-persistent data/ directory, never in a repo.
export const OAUTH_DIR = process.env.NOVA_OAUTH_DIR ?? path.join(process.cwd(), "data", "oauth");
export const CLIENTS_PATH = path.join(OAUTH_DIR, "clients.json");
export const SIGNING_KEY_PATH = path.join(OAUTH_DIR, "signing-key");

export const TOKEN_ISSUER = "nova-ha-dashboard";
export const TOKEN_TTL_SECONDS = 600;

export const SCOPE_UPDATE_FORCE = "update:force";

export const THROTTLE_MAX_FAILURES = 8;
export const THROTTLE_WINDOW_MS = 5 * 60 * 1000;
