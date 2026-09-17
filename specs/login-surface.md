# The Nova login surface

Produced by plan `we-need-to-theme-cozy-eich`
(`~/.claude/plans/we-need-to-theme-cozy-eich.md`), 2026-09-03.

Related, and authoritative where they overlap:

- [`authentik/specs/authentik-sso.md`](../../authentik/specs/authentik-sso.md)
  owns authentik's installation, the forward-auth gate, the Caddy snippet
  ordering and the route inventory. Where this spec and that one disagree about
  a route list, that one wins.
- [`face-auth.md`](face-auth.md) owns the face service, the signing oracle and
  the ceremony. This spec owns the browser surface that drives it.

## Why

authentik's stock login page is the only sign-in UI in the estate, and three
things are wrong with it.

It is unthemed. `branding_custom_css` is empty on the live instance, so the one
screen standing between Adeline and every self-hosted service looks nothing like
the thing behind it.

It splits username and password across two screens. Verified live: posting only
`uid_field` to `default-authentication-flow` advances to a separate
`ak-stage-password` component rather than accepting both together.

And it cannot offer face login at all. The ceremony in `face-auth.md` needs
`getUserMedia` and a call to the dashboard's same-origin `/api/face/*` proxy.
authentik's page can do neither, and it is not the dashboard's origin. Face auth
went live on 2026-09-03 with **no browser entry point whatsoever** — the
credential works, and nothing in any UI can ask for it.

Meanwhile the dashboard has no concept of a logged-in user. There is no
`app/api/auth/*`, no session hook, no guard component. Authentication is
enforced entirely by Caddy in front of Next.js, which is the right place for
enforcement and the wrong place for the only feedback the user ever gets.

## What this is

One Nova-themed surface carrying all three sign-in methods on a single screen:

| affordance | flow slug | what it does |
|---|---|---|
| username + password | `default-authentication-flow` | one POST, after the identification stage is merged (§Password on one screen) |
| **Use Passkey** | `passkey-login` | `navigator.credentials.get()` on the challenge the flow returns |
| **Use Face** | `face-auth-webauthn` | relays the challenge to the face oracle, which signs |

Rendered two ways from one component: a caution-striped **modal** over the
dashboard (the primary form), and a **standalone `/login` page** for direct
visits and `?next=`.

authentik's own page is themed as well rather than replaced. It remains the
destination for direct navigation to a gated route, and for Grafana, the budget
site and Forgejo, none of which route through the dashboard.

---

# The protocol

## Verified live, 2026-09-03

Measured against the running instance before any code was written. These
findings are the reason the design is shaped the way it is.

- `GET /api/v3/flows/executor/default-authentication-flow/?query=` returns
  `component: ak-stage-identification`, `user_fields: [email, username]`,
  **`password_fields: false`**, `passwordless_url: /if/flow/passkey-login/`.
- `GET .../executor/passkey-login/?query=` and
  `GET .../executor/face-auth-webauthn/?query=` each return a WebAuthn challenge
  **immediately and unauthenticated**: `rpId: nova.tuatara-dory.ts.net`,
  `allowCredentials: []` (discoverable credentials carry the identity),
  `userVerification: required`. Both flows are drivable from a custom UI with no
  prior session.
- **CSRF IS enforced on the executor — corrected 2026-09-04.** This entry
  originally read the opposite, and that error broke every sign-in method at
  once for anyone who already had a session.

  The probe that "settled" it POSTed as an **anonymous** caller. DRF's
  `SessionAuthentication.enforce_csrf` only runs once session authentication
  resolves a user, so an anonymous POST is never checked and an authenticated
  one always is. The moment somebody signed in, every stage POST — password,
  passkey and face alike — answered
  `CSRF Failed: CSRF token missing` with an HTTP 500.

  The lesson is about the probe, not about authentik: a security control was
  declared absent after testing only the path where it does not apply. Anything
  of this shape has to be probed in the authenticated state as well, because
  that is the state real users are in.

  Concretely: cookie `authentik_csrf`, header `X-authentik-CSRF`,
  `CSRF_COOKIE_HTTPONLY` false (so the client may read it, by design),
  `CSRF_COOKIE_DOMAIN` None — host-only, which still spans both ports since
  cookies ignore them. `lib/authentik-flow.ts` reads the cookie and sends the
  header on every submit; when no session exists there is no cookie and none is
  wanted.
- **A stage POST answers `302` back to the executor URL itself**, not with the
  next challenge inline. The next challenge is read with a second GET.
- **That redirect must NOT be followed — corrected 2026-09-04.** This entry
  originally said to use `redirect: "follow"`, and that instruction is what
  broke sign-in outright.

  Caddy proxies `/authentik/*` with `handle_path`, which **strips the prefix
  before authentik sees the request**. authentik therefore builds its `Location`
  from the stripped path:

  ```
  POST /authentik/api/v3/flows/executor/default-authentication-flow/?query=
    -> 302 Location: /api/v3/flows/executor/default-authentication-flow/?query=
  ```

  That path is not proxied anywhere. On the dashboard origin it is Next.js,
  which answers `308` (trailing-slash normalisation) and then `404` with an HTML
  body. So every stage POST that authentik **accepted** ended on a 404: the
  server logged `Successful authentication` for the right user, and the browser,
  a few milliseconds later, showed a transport error. Password, TOTP, passkey
  and face all die at the same place, because they all submit through the same
  executor.

  Two things changed, and either alone is sufficient:

  1. `lib/authentik-flow.ts` posts with `redirect: "manual"` and, on a redirect,
     re-reads the challenge from `flowUrl(slug)` — the **prefixed** url it
     already knows. The `Location` carries no information: it is always the
     executor url itself.
  2. `ops/iridium/nova.Caddyfile` adds `header_down Location "^/" "/authentik/"`
     to `ak_flow_routes`, so the prefix is restored on the way out for any other
     consumer. Absolute URLs are untouched — `^/` cannot match them.

  The lesson is the same shape as the CSRF entry above: a finding was recorded
  from a probe that did not exercise the case that matters. "Follow the
  redirect" was true of authentik on its own origin, and false of authentik
  behind a prefix-stripping proxy.
- Per-field validation comes back as `response_errors`, e.g.
  `{"password": [{"string": "This field is required.", "code": "required"}]}`.
- The session cookie is `authentik_session`, `Domain=tuatara-dory.ts.net`,
  `SameSite=None; Secure; HttpOnly`. Estate-wide, and port-agnostic like every
  cookie.
- **authentik sends no CORS headers.** A cross-origin fetch from the dashboard
  page to `:9443` fails before any of the above matters.

## The same-origin requirement, and why it is not negotiable

Two independent constraints force the flow executor to be reached from the
dashboard's own origin.

**CORS.** authentik sends no `Access-Control-Allow-Origin`. A `fetch` from
`https://nova.tuatara-dory.ts.net` to `https://nova.tuatara-dory.ts.net:9443` is
cross-origin — the port differs — and is blocked outright.

**WebAuthn origin.** authentik derives both the RP ID and the expected origin
from the request, in `authentik/stages/authenticator_webauthn/utils.py`:

```python
def get_rp_id(request):   # the Host header, minus the port
def get_origin(request):  # request.build_absolute_uri("/"), minus the trailing slash
```

There is no stage field, no brand field, no setting and no environment variable
for either. A flow served on `:9443` therefore expects assertions whose
`clientDataJSON.origin` is `https://nova.tuatara-dory.ts.net:9443`. A browser on
a page served from `:443` produces `https://nova.tuatara-dory.ts.net`. They do
not match, and both the passkey button and the face button fail.

So the executor is proxied through the dashboard's own `:443` vhost with the
`Host` header pinned:

```
(ak_flow_routes) {
	handle_path /authentik/* {
		reverse_proxy 127.0.0.1:9000 {
			header_up Host nova.tuatara-dory.ts.net
		}
	}
}
```

The browser calls `/authentik/api/v3/flows/executor/<slug>/?query=`;
`handle_path` strips the prefix, so authentik sees its own path. With the Host
pinned and `X-Forwarded-Proto: https` supplied by Caddy, authentik computes
origin `https://nova.tuatara-dory.ts.net` — exactly the page's origin.

This is the same construction, for the same reason, as the existing
`(ak_outpost_routes)` snippet, whose comment already documents that authentik's
provider lookup reads the **raw** `Host` header and never `X-Forwarded-Host`.
Three snippets in `nova.Caddyfile` now depend on that one rule; it is written up
in each.

Imported on the **tailnet `:443` vhost only**, ahead of `config_gate_authed` and
`nova_routes` — `handle` blocks evaluate in file order within a site, which is
what makes the ordering load-bearing. The LAN vhosts deliberately do not import
it: they use `config_gate_denied`, a flat 403 with no login path, and there is
no way to satisfy an authentik gate from a LAN origin by design.

### What this costs, and what it does not

`face-auth.md` §RP ID and origin previously recorded that routing the flow
through `:443` would buy "a cosmetic difference" and was therefore not done.
That judgement was correct for the design it was written against — a headless
oracle driving nothing in a browser. It does not hold for a browser-driven login
surface, where the origin match is the difference between the buttons working
and not working. That section is amended rather than contradicted.

The **RP ID is unchanged**: `nova.tuatara-dory.ts.net`, with no port, because RP
IDs never carry one. Both existing credentials therefore survive the change —
the face-held `nova-face-Addie` credential and Adeline's own LastPass passkey.
Only the origin string moves.

`WEBAUTHN_ORIGIN` in `/etc/nova-face-auth.env` on Iridium becomes
`https://nova.tuatara-dory.ts.net`. The oracle constructs `clientDataJSON` itself
with the pinned origin — see `face-auth.md`, which explains at length why pinning
is correct for a host authenticator — so this one value must track the origin the
flow is actually served from. **Ship the Caddy snippet and the env change in the
same deploy.** Between them the face path is broken.

A consequence worth stating: after the change, the face button works from the
dashboard origin and would not work from authentik's own `:9443` page. That is
fine. The button only exists on the dashboard, and the oracle is not something a
human can invoke by hand.

## Password on one screen

Set `default-authentication-identification.password_stage` to the existing
`default-authentication-password` stage. The executor then reports
`password_fields: true` and accepts `uid_field` and `password` in one
submission. authentik's own page gets the same merge, which is wanted.

**Do not touch `default-authentication-mfa-validation.device_classes` or
`passwordless_flow`.** The 2026-09-03 fix that made a passkey a first factor
rather than a 2FA prompt lives in exactly those two fields, and getting them
wrong is what made login unsatisfiable last time: a `webauthn` entry with
`not_configured_action = skip` skipped only while no WebAuthn device existed,
then began demanding an assertion no browser could produce. Verify after
changing `password_stage` that the identification challenge still reports
`passwordless_url`, and that a password login is still followed by TOTP and not
by a WebAuthn prompt.

TOTP continues to arrive as a separate `ak-stage-authenticator-validate`
challenge after the password. That is correct and is not merged — a second
factor is a second step by definition.

---

# The client

`lib/authentik-flow.ts`. Client-side, same-origin, no secrets: these are public
flows that hand out challenges to anonymous callers by design.

```
executeFlow(slug)               -> GET  /authentik/api/v3/flows/executor/<slug>/?query=
submitChallenge(slug, payload)  -> POST same URL, redirect: "follow", credentials: "same-origin"
```

Components the surface must handle:

| component | rendered as |
|---|---|
| `ak-stage-identification` | username field, plus password when `password_fields` is true |
| `ak-stage-password` | password field alone — the un-merged fallback, kept so a config drift degrades rather than breaks |
| `ak-stage-authenticator-validate` | TOTP code entry, or a WebAuthn `device_challenges` entry |
| `ak-stage-access-denied` | the refusal, with its own message |
| `xak-flow-redirect` | terminal: the flow is done, navigate to `to` |

`response_errors` is rendered per field wherever it appears. A challenge whose
component is not in this table is a configuration change nobody told the UI
about: render the flow's own `title` plus a plain "This sign-in step is not
supported here" and a link to the authentik page, rather than a blank card.
Silent failure on a login screen is the worst possible outcome.

Base64url helpers for challenge and assertion encoding live here too, since both
the passkey and the face path need them and they are easy to get subtly wrong.

## The three paths

**Password.** `executeFlow("default-authentication-flow")`, then submit
`{component, uid_field, password}`. Follow with TOTP when the next challenge is
`ak-stage-authenticator-validate` carrying a code field.

TOTP after the password is the intended design, not a fault to route around —
`authentik/specs/authentik-sso.md` says so, and
`default-authentication-mfa-validation.device_classes`
(`[static, totp, duo, sms, email]`) is explicitly off limits. A password sign-in
that stops at "Authentication code" is working correctly.

**Passkey.** `executeFlow("passkey-login")` returns
`device_challenges[0].challenge` directly, unauthenticated. Pass it to
`navigator.credentials.get()` and submit the assertion as
`{component: "ak-stage-authenticator-validate", webauthn: <assertion>}`. The
browser picks the credential; `allowCredentials` is empty because the credentials
are discoverable and carry the identity, so no username is typed.

**Face.** `executeFlow("face-auth-webauthn")` returns a challenge the same way.
Then:

1. `POST /api/face/challenge` for a single-use nonce (20 s TTL).
2. Record a clip via `getUserMedia` + `MediaRecorder`.
3. `POST /api/face/assert` with `clip`, `nonce` and the WebAuthn `challenge`.
4. Submit the returned assertion back to the executor.

## Capture profiles

**Capture length is a per-site choice.** Adeline, 2026-09-09. The surface that
asks for the sign-in names a profile; the service holds the thresholds and the
consequences. Enrolment is not covered by any of this and keeps the full 4 s
gate — a photograph enrolled into the gallery authenticates every later
sign-in, so that path never relaxes.

| profile | capture | liveness residual | anti-spoof | session |
|---|---|---|---|---|
| `standard` | 4 s clip | 0.012-0.080 | >= 0.85 | normal |
| `quick` | streamed stills until 2 good frames, 5 s give-up | off | off | 15 min idle timeout |
| `image` | one still, first recognised frame wins | off | off | 15 min idle timeout |

Recognition thresholds are identical on all three: `MATCH_COSINE` 0.42,
`MATCH_MARGIN` 0.06. The agreement vote differs only in how many frames it has:
`standard` needs 12 of its 25 evenly-sampled frames; `quick` needs 1 of its 2
good frames; `image` agrees on its single frame. The lockout and release-rate
counters apply unchanged to every profile.

### `quick`: two good frames, then stop

Adeline, 2026-09-11. Replaces the 1 s clip, which ununhexium's webcam could not
deliver: every attempt from it was refused `clip_too_short` or `clip_low_fps`
before a face was looked at. *"Who cares about video feed quality"* — so
`quick` records no clip and has no duration or frame-rate gate at all.

1. The browser opens the camera and takes a nonce, as before.
2. It grabs single JPEG stills from the live preview, one at a time, and posts
   each to `POST /api/face/frame` (`nonce`, `image`). No fixed rate and no fixed
   length — the next still goes as soon as the previous answer lands.
3. The service judges each still with the same detection rules every profile
   uses — one face, detection score >= 0.70, short side >= 96 px, framed
   within the image. A still that passes is **good**; its embedding (never its
   pixels) is held in memory against the nonce. A still that fails is skipped
   and its reason noted. The first two good stills are the ones used; anything
   after them is not analysed.
4. As soon as the answer says two good frames are held, the browser releases
   the camera and posts `/api/face/assert` with the nonce, the WebAuthn
   challenge and `profile=quick`, and no upload.
5. `/assert` spends the nonce, takes the held embeddings, and runs recognition:
   **either** frame naming an enrolled person (0.42 / 0.06) is enough.
6. If two good frames have not arrived **5 s after the preview shows its first
   frame**, the browser stops sampling, releases the camera and posts
   `/assert` anyway. With fewer than two good frames the service refuses with
   the dominant skip reason (e.g. `face_too_small` → "Move closer to the
   camera"), or `too_few_frames`, and writes the `attempts` row. That refusal
   counts toward the lockout exactly as a refused clip did.

Keeping on trying is the point, not a fallback: the kiosk camera is sometimes
out of focus when it opens, and a stream that keeps sampling gives autofocus the
time to settle, where a fixed clip judged whatever it caught.

Limits: `/frame` is behind the same network and armed gates as `/assert`,
refuses a spent or expired nonce (`nonce_invalid`), and analyses at most 60
stills per nonce (`frame_limit` after that). Held embeddings are dropped when
the nonce is spent or expires. Skipped stills write no `attempts` row and do not
count toward the lockout — only the final `/assert` does.

Anti-spoof stays off on `quick` (asked and confirmed 2026-09-11). The second
good frame buys a second chance at recognition, not a photo check.

### Why the photo defences come off rather than down

The liveness residual measures *non-rigid* motion — blink, micro-expression,
out-of-plane parallax. A one-second window barely spans a single blink, so it
judges the clip on a signal the clip is too short to contain. The first live
enrolment measured residuals of 0.015-0.035 against a 0.012 floor on 1 s clips:
passing, but close enough that ordinary stillness would fail. A floor low enough
for a genuine 1 s capture is low enough for a photograph, so the gate is
switched off on the short paths rather than tuned to a number that only looks
like a gate.

Anti-spoof goes with it by instruction. It is frame-level and duration-
independent, so it would have survived a shorter clip on the merits; Adeline
asked for it off on the 1 s path, and `image` cannot carry it either.

**What this costs, stated plainly:** on `quick` and `image` a printed photograph
of an enrolled person, held to the camera, is a working sign-in. Nothing in the
capture path detects it. `standard` is unchanged and still refuses one.

### What bounds it instead

The bound is the session, not the clip. A `quick` or `image` release mints a
session that ends after **15 minutes without activity** — not an absolute cap,
so a person working continuously is not thrown out mid-task, and an unattended
session does not outlive the person who left it.

authentik's `user_login` stage has only an absolute `session_duration`, so the
idle timeout is enforced by the face service: `/assert` records the released
session in `quick_sessions` against the authentik session id from
`sessions_for(username)`, the dashboard sends a throttled activity heartbeat to
`/api/face/activity`, and a sweep in the service `terminate_session`s any row
whose `last_seen` is older than the timeout. Enforcement is server-side, so a
closed tab, a killed browser or a client that simply stops heartbeating all
reach the same end.

**Landing somewhere sane when it fires.** Termination happens server-side with
nothing to tell an open tab it happened, and Caddy's forward-auth gate answers
an unauthenticated hit on `/config*` with a 302 into authentik's own hosted
login screen — correct, but a stark place to land from a page that still looks
open. `ConfigWorkspace` polls `/api/auth/whoami` (the same bare-401 probe
`GatedLink` uses — it never redirects, so it's safe to call from a fetch)
every 60 seconds and on tab-visibility regain, and sends the browser to `/`
itself the moment the session is gone, rather than waiting for a later reload
to hit the gate. Same destination the explicit sign-out flow uses (see
`dashboard-invalidation` above) — a session ending, however it ends, always
surfaces on the dashboard's own front page, never on authentik's.

`standard` sessions are not tracked and are not swept.

### Assigning profiles to surfaces

The config-page gate — `LoginProvider`'s modal, reached through `GatedLink` —
uses `quick`. The standalone `/login` page, which is where every other site
redirects, stays `standard`. `CLIP_DURATION_MS` remains the `standard` default
in the shared capture module, so a surface that does not opt in does not change.

The profile travels as a form field on `/verify` and `/assert` and is written
into the `attempts` row. With the model gates off on two of the three paths,
`attempts` is the only calibration record left, and it has to say which gate was
actually run.

The two nonces are unrelated and neither substitutes for the other: the face
nonce defends the clip against replay, the WebAuthn challenge defends the
assertion. `face-auth.md` says this explicitly and it stays true here.

Capture reuses the shape already in `app/components/FaceEnrolmentConfig.tsx` —
`getUserMedia({video: {width: 1280, height: 720, facingMode: "user"}})`,
`MediaRecorder` with `video/webm`, `stop()` on a timer, one `Blob` posted as
multipart field `clip`. Reuse it rather than writing a second recorder, and keep
its rule that device selection must never bind `/dev/video4`, the MS2109 grabber
carrying the Outside camera.

---

# The surface

## Components

```
app/components/auth/LoginPanel.tsx      facade over auth/login-panel/
app/components/auth/login-panel/        the body: LoginPanel.tsx renders, useLoginFlow.ts
                                        holds all state and the three sign-in paths
app/components/auth/LoginModal.tsx      LoginPanel inside ModalOverlay, striped card
app/components/auth/LoginProvider.tsx   requestLogin() context + the single mounted modal
app/components/auth/useAuthSession.ts   whoami probe, cached
app/login/page.tsx                      LoginPanel full-screen, ?next= support
lib/authentik-flow.ts                   the executor client
app/api/auth/whoami/route.ts            reads the Caddy-injected identity headers
```

## The modal

`ModalOverlay` (`app/components/ModalOverlay.tsx`) already supplies everything
the brief asks for: `createPortal` to `document.body`, a fixed full-viewport
backdrop at `z-index: 10000` with `rgb(0 0 0 / 0.78)` and a 2px blur,
click-outside to dismiss via `onClick` on the backdrop with `stopPropagation` on
the dialog, Escape to dismiss, a focus trap, `inert` and `aria-hidden` on
background siblings, and body scroll lock. **Tapping outside hides it and
cancels** is therefore existing, tested behaviour rather than new code, and the
pending action resolves as cancelled.

The card uses the established caution-stripe treatment: `.system-confirm-card`
plus a pair of `<span className="system-stripe system-stripe-top" aria-hidden>` /
`system-stripe-bottom` children as the first two elements
(`app/globals.css:6059-6111`). Same hatch as `ConfirmDialog`, `SystemBlocker`,
`ExperienceModeModal` and the system-power buttons. The stripes are child spans
rather than pseudo-elements deliberately — the dashboard shell applies an
`::after` press flash to every `MomentaryFeedbackButton` and they would collide.
Colour comes from `--cyber-highlight-rgb`, so the hatch follows the theme rather
than being amber tape.

Mounted once, globally, beside `SystemActivityBlocker` in
`app/components/DashboardGlobalServices.tsx` — a sibling of every routed page in
`app/layout.tsx`, so it covers both `/` and `/config` without being mounted
twice. Driven by a promise-resolving `requestLogin()` in the shape of
`ModuleHost`'s existing `askConfirm`/`settleConfirm` pair: one dialog, whichever
caller is asking.

## The standalone page

`/login` renders the same `LoginPanel` full-screen on the same striped card.
`?next=` is honoured on success, defaulting to `/`. It exists so a link can be
sent, so a bookmark works, and so there is somewhere to land that is not a modal
over a dashboard the user may not have loaded.

`next` is validated as a same-origin path — a leading `/` with no second `/` or
backslash — before it is used. An open redirect on a login page is the classic
way to turn a themed sign-in into a phishing primitive, and the check costs one
line.

## Knowing whether anyone is signed in

`GET /api/auth/whoami` returns `{username, groups, email}` read from the
Caddy-injected `x-authentik-username` / `-groups` / `-email` headers — the same
headers `lib/face-auth-client.ts` already forwards upstream.

It gets its own Caddy block that answers **401 JSON** rather than a 302:

```
@auth_probe path /api/auth/whoami
handle @auth_probe {
	forward_auth https://nova.tuatara-dory.ts.net:9443 {
		uri /outpost.goauthentik.io/auth/traefik
		header_up Host nova.tuatara-dory.ts.net
		copy_headers X-authentik-username X-authentik-groups X-authentik-email
		@unauth status 302
		handle_response @unauth {
			respond 401
		}
	}
	reverse_proxy 127.0.0.1:3001
}
```

**The 401 is the whole point of the route.** On 2026-09-03 live face enrolment
failed because a gated XHR received the outpost's 302 to authentik, and a
cross-origin redirect on a fetch surfaces in the browser as an opaque CORS error
rather than "log in again". The fix at the time was to ungate those routes; the
general fix, for a probe whose entire job is to report auth state, is to answer
with a status the client can read. Any future route that needs to tell an XHR
"you are not signed in" uses this shape and not a redirect.

Consumers: the `/config` link and every admin-write action call `requestLogin()`
on a 401 instead of navigating into a redirect. On success they retry — the
outpost's OAuth round trip then completes silently, because an
`authentik_session` already exists by that point and no UI is involved.

A note on the LAN: `whoami` on a LAN origin returns 403 from
`config_gate_denied`, not 401. The client treats the two differently — 401 means
"sign in", 403 means "not from this address" — and the modal says so rather than
offering a sign-in that cannot succeed.

## When the surface cannot work

The modal is honest about it rather than failing silently:

| condition | shown |
|---|---|
| `window.isSecureContext` is false | Face capture needs the HTTPS address. Password and passkey are still offered. |
| LAN origin (403 from the probe) | Sign in from the HTTPS address — there is no login path on this network. |
| `navigator.credentials` absent | The passkey button is not rendered. |
| no camera, or `getUserMedia` refused | The face button renders its reason and stays disabled. |

## Refusal messages

Two rules, pulling against each other, and both are load-bearing.

**Say what actually failed and what to do next.** Face refusals fall into four
classes and each calls for a different action: the camera could not get a usable
clip (retry), you were not recognised (retry, differently), you were recognised
but the sign-in was not released (retrying cannot help — use the password), and
the request never arrived. A single "that did not work" string is wrong for
three of the four.

**Leak no topology.** The login screen is reachable by anyone who can load the
page, so no message names a host, a port, a service, a key, or which third party
a step depends on. A unit test asserts this over the whole table.

This replaced messages that broke both rules. `no_veto_channel` read "This
person has no Discord account mapped" — naming a third party, and wrong in the
case that actually occurred, where the *lookup* had failed rather than the
mapping being absent. And `no_credential` — recognised, liveness passed, nothing
to sign with — had no wording at all, so the one failure that actually happened
in practice rendered as a generic line with the real cause invisible.

### Reason codes are shown, with two exceptions

The stable `reason` string is rendered small beneath the sentence. That is what
turns "it didn't work" into something searchable and reportable, and a reason
the UI has no wording for is exactly when the raw string is worth the most.

Two sets are withheld, both carrying forward `face-auth.md`'s existing
decisions rather than quietly reversing them:

- **The liveness and match signals** (`liveness_rigid`, `antispoof`,
  `ambiguous`, `too_few_agreeing`). Naming which signal caught you is a tuning
  aid for somebody iterating against the thresholds. `liveness_rigid` and
  `antispoof` also keep identical text, so the message does not leak what the
  code withholds.
- **The three switched-off reasons** (`disarmed`, `locked_out`,
  `rate_limited`). Telling them apart says whether a probing campaign has
  tripped the lockout counter. They collapse to one string as well.

The precise reason is always in `attempts` regardless, which is where the
calibration data belongs.

## Component reuse

Per `nova-ha-dashboard/CLAUDE.md`, the inventory for the repo-root reuse rule:
buttons are `MomentaryFeedbackButton`, the dialog is `ModalOverlay`. The two text
fields are the surface's only raw inputs and are justified — this is a credential
form, and `NumericEntryPopover` is a numeric control. No unstyled `<button>`, no
native `<select>`, no second modal primitive.

---

# Theming authentik itself

authentik stays the destination for direct navigation to a gated route, and for
Grafana, the budget site and Forgejo. It is themed rather than bypassed.

`branding_custom_css` on the Brand object accepts arbitrary CSS and is empty on
the live instance. The stylesheet is versioned at
`authentik/branding/nova-authentik.css` and applied by a script beside
`authentik/deploy-authentik.ps1` via `PATCH /api/v3/core/brands/<pk>/`, setting
`branding_custom_css`, `branding_title` and `ui_theme: dark`.

Applied by script, from a file in git, for one reason: a theme typed into an
admin UI is a theme nobody can review, diff or restore. The same argument the
rest of this estate makes for its Caddyfiles and unit files.

Scope is deliberately modest — palette, the Rajdhani / Share Tech Mono pairing,
the card and button treatment. authentik's flow markup is not ours and will
change under us on upgrade; a stylesheet that depends on its internal structure
is a stylesheet that breaks silently at the worst moment. Style what is stable
and let the rest inherit.

## Why the redirect is not intercepted

The obvious alternative — have Caddy catch the forward-auth 302 and send the
browser to `/login?next=` instead of to authentik — was considered and rejected.

After a successful login the outpost still needs one silent OAuth round trip to
set its proxy cookie, and that round trip *is* a 302 from the same matcher. An
interceptor that cannot distinguish the two loops the user between `/config` and
`/login` forever. Distinguishing them needs a marker cookie and a guard, and the
failure mode of a misfiring guard is that the config page becomes unreachable.

The value bought is that one typed URL lands on a Nova-styled page instead of a
Nova-styled authentik page. That is not worth a loop hazard in front of the only
way into the estate's configuration.

---

# Deployment

Caddy: `nova-ha-dashboard/ops/iridium/nova.Caddyfile`, installed by the existing
deploy path. `caddy validate` before reload — and note the standing trap in that
file, that an unquoted `{$ENV}` substitution collapses a two-argument header
matcher into the one-argument "any value" form and still validates. Nothing here
uses one, and nothing here should introduce one.

Face oracle: `WEBAUTHN_ORIGIN` in `/etc/nova-face-auth.env`, same deploy as the
Caddy snippet, then restart `nova-face-auth.service`.

authentik: the `password_stage` field and the brand CSS are both API changes
against the running instance, made by script, recorded here.

Nothing in `app/`, `lib/` or `ops/` may carry a key or a household name — this
repo pushes to public GitHub. Host addresses are permitted in `specs/` under the
existing scrub exception, and nowhere else.

# Done means

- The modal opens over the dashboard from the `/config` link when signed out,
  blocks the background, and a tap outside dismisses it and cancels the
  navigation.
- Username + password on one screen, followed by TOTP, mints an
  `authentik_session` cookie with `Domain=tuatara-dory.ts.net`, and `/config`
  then loads with the outpost round trip completing invisibly.
- **Use Passkey** signs with Adeline's LastPass credential from the dashboard
  origin. This is the single test that proves the Host override, the RP-ID
  survival and the origin change together.
- **Use Face** completes end to end from the kiosk browser on the tailnet
  origin: clip, assertion, session. A used nonce is refused on resubmission, and
  the refusal renders its string.
- `/login` works standalone, honours `?next=`, and refuses an off-origin `next`.
- `GET /api/auth/whoami` returns 401 JSON when signed out on the tailnet and 403
  on the LAN, and never a redirect.
- The passkey-as-first-factor behaviour from 2026-09-03 is intact: the
  identification challenge still reports `passwordless_url`, and a password login
  is not followed by a WebAuthn prompt.
- Grafana, the budget site and Forgejo show the themed authentik page.
- `npm run test:unit` passes, including the lite-mode contract test.
