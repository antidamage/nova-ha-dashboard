/**
 * Creating and deleting the throwaway authentik user.
 *
 * Moved verbatim from `scripts/verify-signin.mjs`, which stays the entry
 * point (`npm run verify:signin`).
 */

import { TMP_PASSWORD, TMP_USER } from "./config.mjs";
import { akShell } from "./remote.mjs";

export function createThrowawayUser() {
  const py = [
    "from authentik.core.models import User",
    `u, _ = User.objects.update_or_create(username=${JSON.stringify(TMP_USER)}, defaults={"name": "Nova sign-in verification (throwaway)", "path": "users", "is_active": True})`,
    `u.set_password(${JSON.stringify(TMP_PASSWORD)})`,
    "u.save()",
    'print("CREATED", u.pk)',
  ].join("\n");
  const r = akShell(py);
  if (!/CREATED/.test(r.stdout)) {
    throw new Error(
      `could not create the throwaway user: ${(r.stderr || r.stdout).trim().slice(-300)}`,
    );
  }
}

export function deleteThrowawayUser() {
  const py = [
    "from authentik.core.models import User",
    `n, _ = User.objects.filter(username=${JSON.stringify(TMP_USER)}).delete()`,
    'print("DELETED", n)',
  ].join("\n");
  const r = akShell(py);
  const m = /DELETED (\d+)/.exec(r.stdout);
  return m ? Number(m[1]) : -1;
}
