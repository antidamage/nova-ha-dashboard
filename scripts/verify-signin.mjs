#!/usr/bin/env node
/**
 * End-to-end verification of the Nova sign-in surface, against the LIVE system.
 *
 * Why this exists
 * ---------------
 * Every previous "fix" to this feature was verified by inference — reading a
 * config value, or probing one endpoint — instead of by actually signing in.
 * On 2026-09-04 that cost an outage: a CSRF probe was run as an ANONYMOUS
 * caller, DRF only enforces CSRF once session authentication resolves a user,
 * so the control was declared absent after testing the one state where it does
 * not apply. Everyone who already had a session was locked out.
 *
 * So this harness does not ask the system what it thinks it is configured to
 * do. It creates a throwaway authentik user, signs in as that user through the
 * dashboard's own proxied flow executor, asserts the flow reaches its terminal
 * redirect, and then — in the AUTHENTICATED state, which is the state real
 * users are in — proves the CSRF control is both present and satisfied by the
 * header the client sends. The throwaway user is deleted in a `finally`.
 *
 * Read-only against the dashboard code: it drives the live HTTP surface and
 * touches nothing in `lib/` or `app/`.
 *
 * Usage:  npm run verify:signin
 * Exit:   0 when every check passes, 1 otherwise.
 *
 * Never prints a secret. The throwaway password is generated here and deleted
 * at the end of the run, so it is the one credential that may be shown; no
 * token, key or session value is ever logged.
 *
 * See `specs/login-surface.md`. The body lives in `scripts/verify-signin/`.
 */

import { main } from "./verify-signin/main.mjs";

main().catch((err) => {
  console.error(`verify-signin crashed: ${err.stack || err.message}`);
  process.exit(1);
});
