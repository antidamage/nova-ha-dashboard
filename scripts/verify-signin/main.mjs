/**
 * The run order, and the throwaway user's lifetime around it.
 *
 * Moved verbatim from `scripts/verify-signin.mjs`, which stays the entry
 * point (`npm run verify:signin`).
 */

import { checkExecutorReachable, checkLanOffersNoSignIn, checkPasswordOnOneScreen, checkWebauthnChallenge, checkWhoamiUnauthenticated } from "./checks.mjs";
import { TAILNET, TMP_PASSWORD, TMP_USER } from "./config.mjs";
import { runSignInChecks } from "./signin-checks.mjs";
import { check, record, report } from "./store.mjs";
import { createThrowawayUser, deleteThrowawayUser } from "./throwaway-user.mjs";

/* ---------------------------------------------------------------------- main */

export async function main() {
  console.log(`Nova sign-in verification against ${TAILNET}`);

  await check("executor reachable on dashboard origin", checkExecutorReachable);
  await check("username + password on one screen", checkPasswordOnOneScreen);
  await check("passkey-login webauthn challenge", () => checkWebauthnChallenge("passkey-login"));
  await check("face-auth-webauthn challenge", () => checkWebauthnChallenge("face-auth-webauthn"));

  let created = false;
  try {
    createThrowawayUser();
    created = true;
    console.log(`  (throwaway user ${TMP_USER} created, password ${TMP_PASSWORD})`);
    try {
      await runSignInChecks();
    } catch (err) {
      record("REAL password sign-in, end to end", false, `threw: ${err.message}`);
    }
  } catch (err) {
    record("REAL password sign-in, end to end", false, `setup failed: ${err.message}`);
    record("stage redirect is re-readable at the proxied URL", false, "not reached");
    record("CSRF enforced while authenticated", false, "not reached");
  } finally {
    if (created) {
      const n = deleteThrowawayUser();
      console.log(`  (throwaway user deleted: ${n} object${n === 1 ? "" : "s"})`);
      if (n < 1) console.log("  WARNING: the throwaway user may still exist. Check authentik.");
    }
  }

  await check("whoami answers 401, not a redirect", checkWhoamiUnauthenticated);
  await check("LAN origin offers no sign-in", checkLanOffersNoSignIn);

  process.exit(report() === 0 ? 0 : 1);
}
