<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Forcing an update: OAuth-protected endpoint

How an agent tells a dashboard to update itself now, and how that agent proves
it may. Written 2026-10-08 at Adeline's request: auto-update is off on this
install and updates should arrive immediately after a merge, so a deploy is
"merge, then force". Related: `self-update-channel.md` (where updates come from
and the detect/apply split this builds on), `ops/README.md` (the host updater).

## What it does

`POST /api/update/force` queues an `apply` control request for the host updater
(`data/update/control/<id>.json`, the same file the Update button writes) and
returns at once with `202`. The host's per-minute cron picks the request up, so
the update starts within about a minute of the call. The endpoint never builds,
fetches or restarts anything itself; the detect/apply split in
`self-update-channel.md` is unchanged.

Request: optional JSON body `{"sha": "<7-40 hex>"}`. The updater still builds
branch HEAD and logs when a requested sha differs, as it does for the button.

| Status | Meaning |
|---|---|
| 202 | queued. Body `{ queued, status }`, `queued.requestedBy` is `oauth:<client id>`. |
| 401 | no bearer token, or invalid, expired or revoked. `WWW-Authenticate: Bearer`. |
| 403 | token valid but lacks scope `update:force` (`error: insufficient_scope`). |
| 409 | an update is already running (a busy phase older than 30 minutes counts as dead, as elsewhere). |
| 503 | OAuth is not usable on this install (signing key cannot be created). |

`/api/update/apply`, which the Update button uses, is unchanged and stays
unauthenticated: it is the in-page button, on the LAN.

## OAuth shape

A small OAuth 2.0 authorization server for one grant: **client credentials**
(RFC 6749 section 4.4), because the callers are agents, not people.

`POST /api/oauth/token`, `application/x-www-form-urlencoded`:
`grant_type=client_credentials`, optional `scope` (space separated), and the
client's credentials either as HTTP Basic or as `client_id` / `client_secret`
form fields. Success is `200` with `Cache-Control: no-store` and
`{ access_token, token_type: "Bearer", expires_in: 600, scope }`. Errors use the
RFC 6749 section 5.2 names: `invalid_request`, `invalid_client` (401, with
`WWW-Authenticate: Basic`), `unsupported_grant_type`, `invalid_scope`. Omitted
`scope` grants all the client is registered for. Asking for a scope the client
does not hold is `invalid_scope`; nothing is silently narrowed.

Access tokens are stateless: `base64url(payload).base64url(HMAC-SHA256)` where
the payload is `{ iss, sub: <client id>, scope, iat, exp, ver }`, where `ver` is a fingerprint of the client's current secret hash. Lifetime 600
seconds, fixed. Verification checks the signature in constant time, `exp`, and
that the client still exists, is not revoked and still has the `ver` the token
carries, so revoking or rotating a client cuts its tokens off at once without a
token store. `rotate` refuses a revoked client; reinstating one means adding a
new client.

Repeated bad secrets throttle: 8 failures for one client id inside 5 minutes
returns `429` with `Retry-After` until the window clears. In memory, per
process; a restart clears it, and at most 1000 client ids are tracked. The
cost is that anyone who can reach the endpoint can lock a client out for five
minutes by failing against its id; the client keeps working once the window
clears, and this is accepted for a LAN-only dashboard.

## Flexibility: clients are data, scopes are strings

Nothing in the code names an agent, a person or an install. Who may call is a
registry the install owns:

- `data/oauth/clients.json` (inside the bind-persistent `data/`, never in a
  repo): `{ "clients": [ { "id", "label", "secretHash", "scopes": [..],
  "createdAt", "revokedAt"? } ] }`. `secretHash` is `scrypt$<salt hex>$<hash hex>`
  (N=16384, r=8, p=1, 64-byte key); the secret itself is shown once at
  creation and never stored.
- `scripts/oauth-client.mjs` manages it on the host that owns the data
  directory: `add --id <id> --scope <scope> [--label <text>]` (prints the new
  secret once), `list`, `revoke --id <id>`, `rotate --id <id>`. `--dir`
  overrides the data directory, default `./data`. A household that wants its own
  agents to force updates to its own dashboard registers its own clients; there
  is no shared or built-in client, and a fresh install has none, so the force
  endpoint answers `401` to everyone until one is registered.
- The signing key is `data/oauth/signing-key` (32 random bytes, hex, mode 0600,
  created on first use by writing a temp file and hard-linking it into place, so
  it is never seen half-written; keys under 32 characters are refused, including
  from the environment), or `NOVA_OAUTH_SIGNING_KEY` when set. It is per
  install; tokens from one dashboard mean nothing to another.
- `lib/oauth/guard.ts` exports `authorizeOAuthRequest(request, scope)`, the one
  call any route makes to require a scope. New agent-facing endpoints add a
  scope string and that call; the server, registry and tokens do not change.
  Scopes defined today: `update:force`.

Agents that work out of this project's folder are authorised by being given a
registered client; how an agent holds its credential is not specified here and
no credential is ever written to a repository.

## Where the code lives

`lib/oauth/` (constants, secret hashing, client registry, token sign/verify,
throttle, guard), `app/api/oauth/token/route.ts`,
`app/api/update/force/route.ts`, `scripts/oauth-client.mjs`.

## What done means

- A client registered with `update:force` can obtain a token and force an
  update; a client without that scope gets `403`; no token, a forged, expired or
  revoked token gets `401`.
- Revoking or rotating a client rejects its outstanding tokens on the next call.
- The 8-failure throttle returns `429`.
- A fresh install with no `clients.json` answers `401` to every call and creates
  nothing; the signing key appears when the first token is issued or checked.
- The `force` route queues exactly one control request per call and returns
  `409` rather than queueing while an update is running.
