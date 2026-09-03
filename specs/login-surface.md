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
- **CSRF is not enforced on the executor.** No `csrftoken` cookie is issued on
  the GET, and a POST carrying only the `authentik_session` cookie — no
  `X-authentik-CSRF` header — is accepted and processed. This was the single
  largest unknown in the design and it was settled first, because a CSRF
  requirement would have changed the client's shape.
- **A stage POST answers `302` back to the executor URL itself**, not with the
  next challenge inline. The client must follow the redirect and read the JSON
  from the resulting GET. Use `redirect: "follow"` — do not set `manual` and try
  to interpret the `Location`.
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

**Passkey.** `executeFlow("passkey-login")` returns
`device_challenges[0].challenge` directly, unauthenticated. Pass it to
`navigator.credentials.get()` and submit the assertion as
`{component: "ak-stage-authenticator-validate", webauthn: <assertion>}`. The
browser picks the credential; `allowCredentials` is empty because the credentials
are discoverable and carry the identity, so no username is typed.

**Face.** `executeFlow("face-auth-webauthn")` returns a challenge the same way.
Then:

1. `POST /api/face/challenge` for a single-use nonce (20 s TTL).
2. Record ~1 s of video via `getUserMedia` + `MediaRecorder`.
3. `POST /api/face/assert` with `clip`, `nonce` and the WebAuthn `challenge`.
4. Submit the returned assertion back to the executor.

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
app/components/auth/LoginPanel.tsx      the body: fields, the two buttons, all state
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

Face refusal strings are the `reason` values already tabulated in `face-auth.md`
§Enrolment UI contract, reused verbatim — including that `liveness_rigid` and
`antispoof` deliberately render identical text, and that the three lockout
reasons collapse to one string. The user gets no feedback about which signal
caught them; that distinction lives in `attempts`, where it is useful, rather
than in the UI, where it is a tuning aid for an attacker.

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
