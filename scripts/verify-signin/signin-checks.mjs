/**
 * The three assertions one throwaway sign-in drives.
 *
 * Moved verbatim from `scripts/verify-signin.mjs`, which stays the entry
 * point (`npm run verify:signin`).
 */

import { URL } from "node:url";
import { EXECUTOR, TAILNET, TMP_PASSWORD, TMP_USER } from "./config.mjs";
import { follow, isRedirect, request } from "./http.mjs";
import { record } from "./store.mjs";

/**
 * The checks the outage needed. One throwaway session drives three of them,
 * because they are three assertions about the same sign-in and re-running it
 * three times would triple the login events on a live instance:
 *
 *   - the sign-in reaches `xak-flow-redirect` at all;
 *   - the 302 a stage POST answers with is followable BY A BROWSER, i.e. it
 *     stays on the dashboard origin's proxied prefix;
 *   - CSRF is enforced in the AUTHENTICATED state and satisfied by the header
 *     `lib/authentik-flow.ts` sends. Probing this anonymously proves nothing —
 *     that mistake is what caused the outage.
 */
export async function runSignInChecks() {
  const url = EXECUTOR(TAILNET, "default-authentication-flow");
  const jar = new Map();

  const first = await request(url, { jar });
  if (first.json?.component !== "ak-stage-identification") {
    const why = `first challenge was ${first.json?.component ?? first.status}`;
    record("REAL password sign-in, end to end", false, why);
    record("stage redirect is re-readable at the proxied URL", false, "not reached");
    record("CSRF enforced while authenticated", false, "not reached");
    return;
  }

  const csrfHeader = () =>
    jar.has("authentik_csrf") ? { "X-authentik-CSRF": jar.get("authentik_csrf") } : {};
  const post = (payload, extraHeaders = {}) =>
    request(url, {
      method: "POST",
      jar,
      headers: { Referer: `${TAILNET}/login`, Origin: TAILNET, ...extraHeaders },
      body: JSON.stringify(payload),
    });

  /**
   * Re-read the challenge from the PROXIED executor URL, ignoring the Location
   * authentik hands back. authentik builds that header from its own path space,
   * so behind `handle_path /authentik/*` it points at a path the dashboard
   * origin does not serve. Pinning the URL here keeps the remaining assertions
   * meaningful even when that is broken — and the next check reports the break
   * separately rather than hiding it.
   */
  const readChallenge = async () => {
    for (let hop = 0; hop < 5; hop += 1) {
      const res = await request(url, { jar });
      if (!isRedirect(res.status)) return res;
    }
    return request(url, { jar });
  };

  // ---- 1. a real password sign-in.
  const posted = await post(
    { component: "ak-stage-identification", uid_field: TMP_USER, password: TMP_PASSWORD },
    csrfHeader(),
  );
  const notes = [`identification=${posted.status}`];
  let res = isRedirect(posted.status) ? await readChallenge() : posted;
  notes.push(`->${res.json?.component ?? res.status}`);

  // A lone password stage is the un-merged fallback. Drive it too, so config
  // drift is reported as drift rather than as a broken sign-in.
  if (res.json?.component === "ak-stage-password") {
    const p2 = await post({ component: "ak-stage-password", password: TMP_PASSWORD }, csrfHeader());
    res = isRedirect(p2.status) ? await readChallenge() : p2;
    notes.push(`password->${res.json?.component ?? res.status}`);
  }

  const signedIn = res.json?.component === "xak-flow-redirect";
  const errs = res.json?.response_errors ? ` ${JSON.stringify(res.json.response_errors)}` : "";
  record(
    "REAL password sign-in, end to end",
    signedIn,
    `${notes.join(" ")}${signedIn ? ` to=${res.json.to}` : errs}`,
  );

  // ---- 2. the redirect contract the client depends on.
  //
  // A stage POST answers 302 back to the executor, and Caddy's `handle_path`
  // has already stripped `/authentik` by the time authentik builds that header
  // — so the Location points at a path this origin does not serve. That is why
  // `lib/authentik-flow.ts` uses `redirect: "manual"` and re-reads the URL it
  // already knows. The invariant worth guarding is therefore NOT that the
  // Location is followable; it is that re-reading the proxied executor gives
  // the next challenge. Whether the Location would 404 is recorded as evidence,
  // because the day it stops doing so is the day that comment can be retired.
  if (!isRedirect(posted.status) || !posted.location) {
    record(
      "stage redirect is re-readable at the proxied URL",
      !!posted.json,
      `POST answered ${posted.status} inline, no redirect involved`,
    );
  } else {
    const target = new URL(posted.location, url);
    const onPrefix = target.pathname.startsWith("/authentik/");
    // Replay the hop a naive `redirect: "follow"` would take, on a copy of the
    // jar so the live session is not disturbed.
    const naive = await follow(target.toString(), { jar: new Map(jar) });
    const reread = await readChallenge();
    record(
      "stage redirect is re-readable at the proxied URL",
      !!reread.json,
      `302 -> ${posted.location} (${onPrefix ? "keeps" : "drops"} the /authentik prefix; ` +
        `following it blindly ends ${naive.status}) re-read=${reread.status} ` +
        `${reread.json?.component ?? reread.contentType.split(";")[0]}`,
    );
  }

  // ---- 3. CSRF, in the state a real user is actually in.
  if (!signedIn) {
    record("CSRF enforced while authenticated", false, "no authenticated session to probe");
    return;
  }
  if (!jar.has("authentik_csrf")) {
    record(
      "CSRF enforced while authenticated",
      false,
      "signed in, but no authentik_csrf cookie was issued — the client has nothing to send",
    );
    return;
  }

  const probe = { component: "ak-stage-identification", uid_field: TMP_USER };
  const without = await post(probe, {});
  const withHeader = await post(probe, csrfHeader());
  // authentik does not surface a rejected CSRF token as a 403 JSON body. DRF
  // raises, and authentik's error handler renders its generic branded 500 HTML
  // page, so the string "CSRF Failed" reaches the log and not the response.
  // Match on the shape instead: 403, or a 500 that is not JSON.
  const csrfRefusal = (r) =>
    r.status === 403 || /CSRF/i.test(r.text) || (r.status === 500 && r.json === null);
  const enforced = csrfRefusal(without);
  const accepted = !csrfRefusal(withHeader);
  record(
    "CSRF enforced while authenticated",
    enforced && accepted,
    `no-header=${without.status} ${enforced ? "refused (correct)" : "ACCEPTED — control absent"}; ` +
      `with-header=${withHeader.status} ${accepted ? "ok" : "STILL REFUSED"}`,
  );
}
