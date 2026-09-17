/** Prefix stripped by Caddy's `handle_path`, so authentik sees its own paths. */
export const AUTHENTIK_PREFIX = "/authentik";

export const FLOW_DEFAULT = "default-authentication-flow";
export const FLOW_PASSKEY = "passkey-login";
export const FLOW_FACE = "face-auth-webauthn";

/** authentik's terminal component: the flow is finished, go to `to`. */
export const FLOW_REDIRECT = "xak-flow-redirect";
