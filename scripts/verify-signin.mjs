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
 * See `specs/login-surface.md`.
 */

import https from "node:https";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";

const TAILNET = "https://nova.tuatara-dory.ts.net";
const EXECUTOR = (origin, slug) =>
  `${origin}/authentik/api/v3/flows/executor/${slug}/?query=`;
const RP_ID = "nova.tuatara-dory.ts.net";
const LAN_ORIGINS = ["https://nova.local", "https://192.168.8.20"];

const IRIDIUM = "antidamage@192.168.8.20";
const SSH_KEY = `${process.env.USERPROFILE || process.env.HOME}/.ssh/id_ed25519_nova_ha`;
const SSH_OPTS = [
  "-o", "BatchMode=yes",
  "-o", "IdentitiesOnly=yes",
  "-o", "StrictHostKeyChecking=no",
  "-o", "UserKnownHostsFile=/dev/null",
  "-o", "LogLevel=ERROR",
  "-i", SSH_KEY,
];

const TMP_USER = "nova-verify-throwaway";
const TMP_PASSWORD = `verify-${randomBytes(12).toString("hex")}`;

/* ------------------------------------------------------------------ plumbing */

/**
 * One HTTPS request. The cookie jar is applied on the way out and any
 * `Set-Cookie` merged back in on the way home. Nothing is followed here:
 * redirects are handled by the caller, because a stage POST answers 302 and
 * both the cookies it sets and the Location it names are evidence this harness
 * has to look at rather than let a client library resolve away.
 */
function request(url, { method = "GET", headers = {}, body, jar, insecure = false } = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const cookieHeader = jar && jar.size
      ? [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ")
      : undefined;
    const req = https.request(
      {
        hostname: u.hostname,
        port: u.port || 443,
        path: u.pathname + u.search,
        method,
        rejectUnauthorized: !insecure,
        servername: u.hostname,
        headers: {
          Accept: "application/json, text/html;q=0.5",
          ...(cookieHeader ? { Cookie: cookieHeader } : {}),
          ...(body
            ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) }
            : {}),
          ...headers,
        },
        timeout: 20000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          if (jar) {
            for (const raw of res.headers["set-cookie"] || []) {
              const [pair] = raw.split(";");
              const idx = pair.indexOf("=");
              if (idx > 0) jar.set(pair.slice(0, idx).trim(), pair.slice(idx + 1).trim());
            }
          }
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not JSON; that is data too */
          }
          resolve({
            status: res.statusCode,
            headers: res.headers,
            contentType: res.headers["content-type"] || "",
            location: res.headers.location || null,
            text,
            json,
          });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("ETIMEDOUT")));
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

const isRedirect = (status) => [301, 302, 303, 307, 308].includes(status);

/**
 * `request`, following up to 5 redirects exactly as a browser would, and
 * keeping every hop's cookies. No path rewriting: this is the honest client.
 */
async function follow(url, opts = {}) {
  let current = url;
  let options = opts;
  let res = null;
  for (let hop = 0; hop < 6; hop += 1) {
    res = await request(current, options);
    if (!isRedirect(res.status) || !res.location) return { ...res, finalUrl: current };
    current = new URL(res.location, current).toString();
    // A 302/303 answer to a POST is re-read with GET, per the executor contract.
    const keepMethod = res.status === 307 || res.status === 308;
    options = { ...options, method: keepMethod ? options.method : "GET", body: undefined };
  }
  return { ...res, finalUrl: current };
}

function ssh(command) {
  const out = spawnSync("ssh", [...SSH_OPTS, IRIDIUM, `bash -c ${JSON.stringify(command)}`], {
    encoding: "utf8",
    timeout: 180000,
  });
  return { code: out.status, stdout: out.stdout || "", stderr: out.stderr || "" };
}

/**
 * Run Python inside authentik's own shell. The source is base64'd so it
 * survives three layers of quoting (local shell, iridium's fish login shell,
 * `docker exec`), and stdin comes from /dev/null because `docker exec -i`
 * otherwise swallows the parent's.
 */
function akShell(python) {
  const b64 = Buffer.from(python, "utf8").toString("base64");
  const inner = `exec(__import__('base64').b64decode('${b64}').decode())`;
  return ssh(
    `docker exec -i authentik-server-1 ak shell -c ${JSON.stringify(inner)} < /dev/null 2>/dev/null`,
  );
}

/**
 * The LAN vhosts are not reachable from every workstation (AP isolation, a
 * different segment). Try them directly first; fall back to running the same
 * probe from iridium, which is on the LAN by definition.
 */
async function lanProbe(path) {
  for (const origin of LAN_ORIGINS) {
    try {
      const res = await follow(`${origin}${path}`, { insecure: true });
      return {
        via: origin,
        status: res.status,
        contentType: res.contentType,
        json: res.json,
        text: res.text,
      };
    } catch {
      /* try the next name, then SSH */
    }
  }
  const url = `${LAN_ORIGINS[0]}${path}`;
  const r = ssh(
    `curl -skL --max-time 15 -o /tmp/nova-verify-lan.out -w '%{http_code} %{content_type}' ${JSON.stringify(url)}; echo; cat /tmp/nova-verify-lan.out; rm -f /tmp/nova-verify-lan.out`,
  );
  const [head, ...rest] = r.stdout.split("\n");
  const [status, contentType = ""] = head.trim().split(" ");
  const text = rest.join("\n");
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* fine */
  }
  return { via: `${LAN_ORIGINS[0]} (via iridium)`, status: Number(status), contentType, json, text };
}

/* -------------------------------------------------------------------- checks */

const results = [];

function record(name, pass, evidence) {
  results.push({ name, pass, evidence });
}

async function check(name, fn) {
  try {
    const { pass, evidence } = await fn();
    record(name, pass, evidence);
  } catch (err) {
    record(name, false, `threw: ${err.message}`);
  }
}

async function checkExecutorReachable() {
  const res = await request(EXECUTOR(TAILNET, "default-authentication-flow"));
  const isJson = res.contentType.includes("application/json") && res.json !== null;
  return {
    pass: res.status === 200 && isJson,
    evidence: `${res.status} ${res.contentType.split(";")[0]} component=${res.json?.component ?? "-"}`,
  };
}

async function checkPasswordOnOneScreen() {
  const res = await request(EXECUTOR(TAILNET, "default-authentication-flow"));
  const c = res.json || {};
  const ok =
    res.status === 200 &&
    c.component === "ak-stage-identification" &&
    c.password_fields === true &&
    typeof c.passwordless_url === "string" &&
    c.passwordless_url.length > 0;
  return {
    pass: ok,
    evidence: `${res.status} component=${c.component} password_fields=${c.password_fields} passwordless_url=${c.passwordless_url ?? "MISSING"}`,
  };
}

async function checkWebauthnChallenge(slug) {
  const res = await request(EXECUTOR(TAILNET, slug));
  const dc = res.json?.device_challenges?.find((d) => d.device_class === "webauthn");
  const rpId = dc?.challenge?.rpId;
  return {
    pass:
      res.status === 200 &&
      !!dc &&
      rpId === RP_ID &&
      typeof dc.challenge?.challenge === "string",
    evidence: `${res.status} device_class=${dc?.device_class ?? "NONE"} rpId=${rpId ?? "MISSING"} userVerification=${dc?.challenge?.userVerification ?? "-"}`,
  };
}

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
async function runSignInChecks() {
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

async function checkWhoamiUnauthenticated() {
  const res = await request(`${TAILNET}/api/auth/whoami`);
  return {
    pass: res.status === 401 && !isRedirect(res.status),
    evidence: `${res.status}${res.location ? ` -> ${res.location}` : ""} (401 required; a redirect reaches an XHR as an opaque CORS error)`,
  };
}

async function checkLanOffersNoSignIn() {
  const whoami = await lanProbe("/api/auth/whoami");
  const flow = await lanProbe(
    "/authentik/api/v3/flows/executor/default-authentication-flow/?query=",
  );

  // The UI must be able to READ the answer: a status it can branch on, never a
  // redirect, and never an authenticated identity.
  const whoamiReadable =
    whoami.status === 403 ||
    (whoami.status === 200 && !!whoami.json && whoami.json.authenticated === false);
  // `ak_flow_routes` is not imported on the LAN vhosts, so /authentik/* must
  // fall through to Next.js. Anything answering a flow challenge here is a
  // misconfiguration that hands the LAN a login path it can never satisfy.
  const flowNotProxied = !(flow.json && typeof flow.json.component === "string");

  return {
    pass: whoamiReadable && flowNotProxied,
    evidence: `via ${whoami.via} | whoami=${whoami.status}${whoami.json ? ` authenticated=${whoami.json.authenticated}` : ""} | /authentik/*=${flow.status} ${flow.contentType.split(";")[0]}${flowNotProxied ? " (not proxied)" : " (PROXIED, leak)"}`,
  };
}

/* ---------------------------------------------------------------------- main */

function createThrowawayUser() {
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

function deleteThrowawayUser() {
  const py = [
    "from authentik.core.models import User",
    `n, _ = User.objects.filter(username=${JSON.stringify(TMP_USER)}).delete()`,
    'print("DELETED", n)',
  ].join("\n");
  const r = akShell(py);
  const m = /DELETED (\d+)/.exec(r.stdout);
  return m ? Number(m[1]) : -1;
}

function report() {
  const width = Math.max(...results.map((r) => r.name.length));
  console.log("");
  for (const r of results) {
    console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name.padEnd(width)}  ${r.evidence}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log("");
  console.log(`${results.length - failed}/${results.length} checks passed.`);
  return failed;
}

async function main() {
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

main().catch((err) => {
  console.error(`verify-signin crashed: ${err.stack || err.message}`);
  process.exit(1);
});
