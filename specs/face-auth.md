# Face-released passkey authentication

Produced by plan `expand-on-this-plan-enumerated-garden`
(`~/.claude/plans/expand-on-this-plan-enumerated-garden.md`), 2026-09-02.
Supersedes the passkey and authentik sections of the previous pass; the model,
threshold, liveness, gallery, enrolment and API sections are carried forward.

Related: [`authentik-sso.md`](../../authentik/specs/authentik-sso.md) — that spec
owns authentik's installation, the forward-auth gate, the Caddy snippet
ordering, the unauthenticated-route inventory and the outpost callback rule.
This spec owns the face service and the WebAuthn authenticator that signs for
it. Where the two disagree about a route list, `authentik-sso.md` wins.

## Why

Nova has identity but no authentication. `camera-events/service.py` matches whole
bodies with DINOv2 embeddings against `subject_references` — enough to say "the
owner is in the room" and suppress an alert, not enough to let anybody in. The
existing trust boundary is a shared header (`X-Nova-LLM-Key`) plus LAN/Tailscale
reachability; authentik authenticates humans with password + TOTP.

Two things, in order:

1. **A LAN face API.** RetinaFace detection with 5-point landmarks, ArcFace
   512-d embeddings, served on Iridium's GPU. Any Nova surface can ask "who is
   standing here". Useful on its own to camera-events, the kiosk and the voice
   satellites, independent of anything below.
2. **Face-released passkey.** A recognised, live face releases one use of a
   WebAuthn credential held on the trusted host. The credential is the thing
   authentik trusts. Face is the release condition on its use.

Face is never a bearer credential and never becomes one. Nothing downstream
accepts "the face service said it was Adeline" as proof; downstream accepts an
authentik session, minted from a signed assertion.

The premise of the whole design is that **face recognition is weak**. Adeline
said so, and the design agrees. The effort is spent on making a defeat
**bounded, loud and revocable**, not on claiming it cannot happen. See
[Threat model](#threat-model) before anything else here is read as a security
claim.

Consent scope: this is the owner's own household, and enrolment is of
consenting household members only. Identifying anyone who has not enrolled is
out of scope and the service has no path to it — `/identify` returns `null` for
an unknown face, never a nearest neighbour. Face enrolment here is the visual
twin of the voice speaker profiles already in `SpeakerProfilesConfig`.

## Repository

Public GitHub repo `nova-ha-dashboard` (`origin =
github.com/antidamage/nova-ha-dashboard`, `local` = Forgejo on Ununhexium). See
[Secrets and the public remote](#secrets-and-the-public-remote) before writing a
single line.

```
face-auth/
  core.py                 pure maths + decisions; numpy only, no model, no GPU, no I/O
  models.py               ONNX loading, lazy, provider fallback, warm-up
  service.py              FastAPI app, SQLite, auth middleware, gates
  authenticator/
    store.py              credentials table, seal/unseal, Argon2id KDF
    ctap.py               clientDataJSON, authenticatorData, ES256 assertion
    authentik.py          credential registration + session revocation
    harness.py            local WebAuthn RP test double, tests only
  test_core.py            unittest
  test_authenticator.py   unittest
  Dockerfile
  requirements.txt
ops/iridium/nova-face-auth.service
app/components/config/UserDataConfig.tsx   face enrolment, beside SpeakerProfilesConfig
app/api/face/**                            same-origin proxy routes
lib/face-auth-client.ts                    server-side fetch helper, holds the key
```

## Hosts

| role | host | note |
|---|---|---|
| service | Iridium, 192.168.8.20 | GPU, co-resident with the LLM and camera-events. Tailnet name is `nova.tuatara-dory.ts.net`; `iridium.tuatara-dory.ts.net` does not exist. |
| capture / enrolment | Nocturnium, 192.168.8.17 | the kiosk box, `/dev/video0`, on the tailnet since 2026-09-02 |

The capture camera on Nocturnium is the built-in UVC webcam, "IMC Networks
USB2.0 HD UVC WebCam", at `/dev/video0`. **`/dev/video4` is the MS2109 grabber
carrying the Outside camera and is not the face camera** — it is already owned by
the camera recorder, and pointing enrolment at it would enrol whoever walks past
the front of the house.

The service never opens a capture device. It is a stateless verifier of clips
submitted to it. That keeps the GPU host free of camera plumbing and means a
satellite, the kiosk, or a script are all clients on equal terms.

---

# The security design

## The ceremony

The browser relays the authentik challenge to the face oracle. The session
cookie lands in the browser natively; no token is transplanted across origins.

```
browser   -> authentik : begin flow (forward-auth redirect)
authentik -> browser   : WebAuthn challenge
browser   -> face-auth : POST /api/face/assert { challenge, clip, nonce }
face-auth              : nonce ok? network ok? armed? not locked out?
                         liveness (residual + antispoof) -> identity -> subject
                         unseal ES256 -> sign -> zero key
face-auth -> browser   : assertion
face-auth -> Discord   : "session opened" + Revoke / Disarm buttons
browser   -> authentik : assertion
authentik -> browser   : session cookie (domain tuatara-dory.ts.net)
```

`/api/face/assert` is the dashboard's same-origin proxy route; on the service
itself the path is `POST /assert`. The proxy injects `X-Nova-Face-Key`
server-side — the browser never holds it.

The face service is not a WebAuthn *client* driving authentik's flow executor.
That was the previous pass's design and it is retired along with `/auth/face`.
The browser drives the flow, exactly as it would for a hardware key; the oracle
only signs.

**The browser that drives it, added 2026-09-03.** Through this spec's first live
pass there was no such browser: the credential worked, the ceremony was correct,
and no UI anywhere could begin it. authentik's own login page cannot — it is a
different origin and cannot reach `getUserMedia` or the dashboard's `/api/face/*`
proxy. The **Use Face** button on the Nova login surface is the missing first
step, and `specs/login-surface.md` owns it. Nothing in the ceremony above
changes; a caller finally exists for it.

## Threat model

Stated plainly, because the design rests on being honest here. None of the three
is a defect to be fixed later; each is a property of this topology.

- **A successful face spoof is a successful login.** The oracle cannot verify
  that a challenge came from a genuine authentik flow — an attacker can start
  their own flow and present its challenge. That is exactly what the legitimate
  path does. There is no cryptographic fix inside this topology; the controls
  below bound the consequence instead.
- **Root on Iridium defeats the sealed key.** The Argon2id wrap over the host
  secret buys blast-radius reduction and replay-binding, not secrecy from root.
  Worse in practice than the concession implies: the unit passes secrets with
  `--env-file`, so `NOVA_FACE_KEY` and `NOVA_FACE_HOST_SECRET` are readable from
  `docker inspect` by anyone in the `docker` group — a wider set than root, and
  membership in that group is effectively root anyway.
- **A video replay of Adeline's face is not geometrically rigid and will pass
  the landmark-residual test.** A recording of a real face moves exactly the way
  the real face moved. The nonce and the anti-spoof texture model are what catch
  it. The residual does not stand alone and must never be written up as if it
  does.

An honest summary of the strength: this is a convenience credential with
revocation, on a household LAN, whose worst realistic outcome is a full estate
session held by somebody with a good photo, physical access to the house or the
tailnet, and the ability to survive a Discord DM landing on Adeline's phone
within seconds.

## Controls, and the property each one holds

| Control | Property |
|---|---|
| **Network binding** | The oracle refuses unless the caller is in the household LAN (`192.168.8.0/24`) or the tailnet CGNAT range (`100.64.0.0/10`), taken from Caddy's forwarded client IP with the direct peer as fallback. A photo of Adeline still requires being inside the house or on the tailnet. Configurable CIDR list, default-deny. |
| **Rate limit + lockout** | Per-subject and global counters. N failed liveness/identity attempts in a window sets `armed = false`, disabling face release entirely until cleared **from a password + TOTP authentik session — never by a face**. Also caps *successful* releases per hour, because a spoof that works once can otherwise be replayed for fresh sessions indefinitely. |
| **Discord veto, account-aware** | Every signature DMs the Discord account mapped to that subject's authentik user, naming subject, client IP, surface and time, with **Revoke this session** and **Disarm face login** buttons plus an HMAC-signed single-use fallback link. |
| **Audit** | Every attempt and every signature lands in `attempts` with all signal scores, client IP, decision, and the resulting authentik session id. This is also the calibration data for the thresholds. |

All four gates are evaluated **before any model runs**, so a locked-out or
off-network caller costs no GPU and no queue position behind a voice turn.

### The revocation-only asymmetry — a rule future work must not break

**A compromised Discord account can disable face login or kill a session. It can
never grant one.** Only the mapped `discordUserId`'s presses are honoured; any
other press is ignored and logged. There is no Discord action, link, reply or
slash command anywhere in this design that arms face login, clears a lockout,
registers a credential, or approves a pending assertion.

That asymmetry is what makes it safe to put a security control on a third-party
service that Nova does not operate. Any future change that adds an approving
Discord action breaks the control rather than extending it — re-arming stays on
the password + TOTP path, and a "convenience" re-arm button is the exact thing
this rule exists to refuse.

### Control thresholds

Defaults, env-overridable, read once at startup, same discipline as the model
thresholds below.

| name | default | rationale |
|---|---|---|
| `FACE_ALLOWED_CIDRS` | `192.168.8.0/24,100.64.0.0/10` | Household LAN and the tailnet CGNAT range. Default-deny: an unparseable or empty list refuses everything rather than allowing everything. |
| `FACE_TRUST_FORWARDED_FOR` | `1` | Caddy terminates TLS and is the only thing in front of the service, so its forwarded client IP is authoritative. Set `0` for a topology where the service is directly reachable and the header would be attacker-supplied. |
| `FACE_LOCKOUT_FAILURES` | `5` | Failed liveness/identity attempts, per subject, within the window. Five is above what a real person costs themselves in bad lighting (calibration runs routinely produce 2–3) and far below what a spoof-tuning attacker needs — the attacker is iterating against thresholds and needs tens of attempts, not five. **Tune from `attempts` once a live population exists.** |
| `FACE_LOCKOUT_GLOBAL_FAILURES` | `12` | Same window, all subjects plus the unattributable failures (a refused clip usually has no subject, so per-subject counting alone cannot see a spoof campaign). Above the sum of two people having a bad day; well below a scripted sweep. |
| `FACE_LOCKOUT_WINDOW_SECONDS` | `900` | 15 minutes. Long enough that an attacker cannot wait out the counter between attempts at any useful rate; short enough that yesterday's failures do not lock out today's login. |
| `FACE_RELEASE_MAX_PER_HOUR` | `6` | Successful releases, globally, per rolling hour. A household needs a handful; a spoof that works needs the ability to mint sessions on demand. Exceeding this sets `armed = false` — it is treated as an attack signal, not as backpressure. |
| `FACE_VETO_LINK_TTL_SECONDS` | `900` | Fallback link lifetime. It exists for the case where the Discord buttons fail; it must outlive noticing the DM and must not be a standing capability. |

Lockout state is durable in SQLite, not in process memory. A restart must not
clear a lockout — restarting a container is the cheapest thing an attacker on
the LAN can cause.

Re-arming is `POST /arm`, reachable **only** through the authentik-gated
`/api/face/*` admin proxy route (password + TOTP session). The face service
itself refuses `/arm` unless the dashboard proxy asserts an authenticated
identity; the header alone is not sufficient, because the header is held by
every LAN service that talks to the oracle.

### Flagged, not built: short session TTL

A face-obtained authentik session could carry a short TTL with no silent
refresh, so a spoofed session expires in minutes and re-presenting a face is the
only way to extend it. Re-presenting a face is cheap for the legitimate user and
expensive for an attacker who has left the house.

It is not built because Adeline chose **full estate SSO** — a face-released
passkey yields the same domain-level session a password + TOTP login would —
and did not select a shortened TTL. Recorded here so the omission is a decision
rather than an oversight. If face is later judged too weak for an estate-wide
session, this is the first thing to add, and it needs no change to the ceremony.

## The signing oracle

The authenticator is a module in the same process as the face decision, so the
decision never crosses a process boundary before it authorises a signature.

One WebAuthn resident credential per subject per relying party. ES256/P-256,
stored encrypted with libsodium `crypto_secretbox`. The data-encryption key is
derived by Argon2id over `(host secret from /etc/nova-face-auth.env, subject id,
the face-session token)`.

`sign_assertion()` takes the sealed blob and the face-session token, derives the
DEK, unseals, signs, and zeroes the plaintext buffer in a `finally` before
returning. No helper returns raw key bytes to any caller. The signature counter
increments per assertion and persists.

`fido2` supplies CBOR/COSE encoding and attestation structures only. It does not
hold keys — custody is `store.py`'s, so the sealing and zeroing behaviour is ours
to prove in a test rather than assumed from a library.

The face-session token is minted by this same service, so binding it into the
KDF buys replay-binding and blast-radius reduction, **not secrecy against a host
that is already compromised**. See the threat model above.

### RP ID and origin

| | value |
|---|---|
| RP ID | `nova.tuatara-dory.ts.net` |
| Origin, pinned | `https://nova.tuatara-dory.ts.net` — **changed 2026-09-03, see below** |

Both are configuration in `/etc/nova-face-auth.env` (`WEBAUTHN_RP_ID`,
`WEBAUTHN_ORIGIN`), never constants — they are household hostnames and this repo
is public.

**Corrected 2026-09-02, against the live instance.** This section previously
specified the *parent* domain `tuatara-dory.ts.net`, reasoning that a
parent-domain RP ID would let one credential cover every estate service.
authentik cannot do that. Its
`authentik/stages/authenticator_webauthn/utils.py` derives both values from the
request:

```python
def get_rp_id(request):   # the Host header, minus the port
def get_origin(request):  # request.build_absolute_uri("/"), minus the trailing slash
```

There is no stage field, no brand field, no setting and no environment variable
for either — so the RP ID is whatever host the flow is served on, and the origin
carries the port. Since authentik is fronted at `:9443`, the achievable values
are the ones in the table.

**This costs nothing.** The estate-wide reach of the session comes from
authentik's *cookie* domain, which is configured independently and is still
`tuatara-dory.ts.net`. A face-released session covers every service exactly as
intended; only the credential's scope is narrower, and a credential this daemon
holds is never presented anywhere else anyway. The original reasoning was sound
and simply did not apply.

Changing it would mean routing `/api/v3/flows/**`, `/flows/**` and `/static/**`
on the `:443` tailnet vhost to `127.0.0.1:9000` with `header_up Host`, and
driving the flow from that origin. Not done: it edits shared ingress to buy a
cosmetic difference.

**Superseded 2026-09-03 — the origin is now `https://nova.tuatara-dory.ts.net`,
with no port.** The paragraph above is kept because its reasoning was correct
for the design it described, and because the change is only intelligible against
it.

What changed is not the analysis but the premise. That paragraph assumed nothing
in a browser would ever drive one of these flows — the oracle was headless and
the difference really was cosmetic. `specs/login-surface.md` puts a **Use Face**
button on the dashboard, and a browser on a page served from `:443` produces
`clientDataJSON.origin` of `https://nova.tuatara-dory.ts.net`. authentik expects
whatever origin the flow was served from. Served on `:9443`, the two do not match
and the button cannot work. It is now the difference between the feature existing
and not existing.

So the flow executor **is** proxied through the `:443` tailnet vhost, under
`/authentik/*`, with `header_up Host nova.tuatara-dory.ts.net` — the
`(ak_flow_routes)` snippet in `ops/iridium/nova.Caddyfile`. `login-surface.md`
owns that snippet and its ordering.

Consequences, all of them small:

- **`WEBAUTHN_ORIGIN` in `/etc/nova-face-auth.env` drops the `:9443`.** It must
  track the origin the flow is actually served from, because the oracle pins it
  into `clientDataJSON` itself.
- **No credential is invalidated.** RP IDs carry no port, and the RP ID is
  unchanged, so `nova-face-Addie` and Adeline's LastPass passkey both survive.
- **Ship the Caddy snippet and the env change together.** Between the two the
  face path is broken, and there is no reason to have a deploy in which it is.
- The face path now works from the dashboard origin and not from authentik's own
  `:9443` page. That is fine: the button only exists on the dashboard, and the
  oracle is not something a human invokes by hand.

`/static/**` and `/flows/**` are **not** proxied. The dashboard renders its own
login UI and never loads authentik's assets, so only the executor API and the
flow-cancel endpoint are needed. Proxying less of authentik onto the dashboard's
origin is the better default.

**The oracle constructs `clientDataJSON` itself, with the pinned origin,
regardless of where the clip came from.** That is correct, not a shortcut,
because this is a *host authenticator*, not a browser:

- In the ordinary WebAuthn split, the browser is the trusted party that computes
  `clientDataJSON`, because the browser is what actually knows which origin the
  user is on and enforces same-origin. The authenticator (a YubiKey) never sees
  an origin at all — it receives an opaque `clientDataHash` and signs it.
- Here the authenticator and the "client" are the same process, and there is no
  browser inside it. If the oracle accepted an origin supplied by its caller, the
  origin field would be attacker-chosen and would assert nothing. Pinning it is
  the only construction that makes the field mean what the relying party reads it
  to mean.
- Pinning is also honest about what is being attested. The signature says "the
  host authenticator for `nova.tuatara-dory.ts.net` released this credential",
  which is exactly true. It does not claim a browser origin check happened,
  because none did.

Consequently authentik's origin check on the assertion is satisfied by
construction and provides no security here. It is not a control, and it is not
counted as one anywhere in this spec. The controls are the four in the table
above.

`authentik.py` covers the two things that genuinely need authentik's API:
one-time registration of each credential from an authenticated admin session,
and session termination for the veto path. It no longer drives the login flow.

`harness.py` is a local WebAuthn RP test double so the register-then-assert round
trip is provable without waiting on authentik's flow configuration.

## Threat model, revised 2026-09-03

Adeline, after the first live enrolment: *"I've stated it before and you ignored
it, but I don't care about spoofing. this is a convenience thing. assume that
nobody with malicious intent will have access to my house."*

That is the governing constraint and it outranks the security posture the rest
of this spec was written with. What follows from it:

- **The anti-spoof model is advisory, not enforcing.** `FACE_ANTISPOOF_MIN=0.0`
  in `/etc/nova-face-auth.env`. The score is still computed and logged on every
  attempt, so the data to re-enforce is being collected, but it cannot refuse
  anyone. It was the component refusing every real face while misconfigured, and
  what it defends against is an attacker she has ruled out. Raise it to `0.85`
  to turn it back on.
- **The residual floor is 0.005**, down from the spec's guessed 0.012, chosen
  from her measured clips: live captures ran 0.0138-0.0348 and a frozen frame
  scores 0.00069. It stays non-zero because a camera that has stopped producing
  new frames is a reliability failure worth catching, not a security one.
- **Enrolment is not double-gated.** `/api/face/enrol*` and
  `/api/face/subjects*` sit behind the `/config` page gate and no longer behind
  forward-auth as well. Gating the XHR too meant the outpost answered an
  unauthenticated fetch with a 302 to authentik, which a browser reports as an
  opaque CORS error. `/api/face/arm` and `/api/face/health` stay gated: `arm`
  clears a lockout, so it grants rather than records.
- **The physical spoof test is dropped**, not deferred. It was listed as the
  acceptance gate through several rounds; it is not one. Do not re-add it.

The design still holds the properties it was built with — the passkey remains
the credential, face remains a release condition and never a bearer token, the
veto stays revocation-only, and the liveness residual still rejects a static
frame. Those cost nothing to keep. The change is that friction is now the thing
being minimised, not spoof resistance.


## Route gating

Two classes of face route, gated differently, because one of them *is* the login
path and therefore cannot require a login.

| route (dashboard origin) | gate | why |
|---|---|---|
| `/api/face/enrol*` | authentik forward-auth, **tailnet origin only** | Registering a face is a credential-issuing action. It gets the strongest gate available. |
| `/api/face/subjects*` | authentik forward-auth, tailnet origin only | Deleting a subject deletes a credential; listing subjects enumerates the household. |
| `/api/face/arm` | authentik forward-auth, tailnet origin only | Clearing a lockout. Password + TOTP, never a face — the lockout exists precisely because faces are being refused. |
| `/api/face/challenge` | **ungated** | Issues the replay nonce. Gating it would mean needing a session to get a session. |
| `/api/face/assert` | **ungated** | This is the login. |
| `/api/face/disarm` | **ungated** | Sets `armed = false`. Only takes access away. The veto has to work in the seconds after a DM lands on a phone, from whatever device is to hand — a password + TOTP round trip in front of it would mean the control is unavailable exactly when it is needed. |
| `/api/face/sessions/revoke` | **ungated** | Terminates one session. The worst an attacker achieves by reaching it is logging somebody out. |
| `/face/veto*` | **ungated**, HMAC-signed and single-use | Revocation-only. It must work when Adeline cannot log in; that is the situation it exists for. |

**Why `arm` and `disarm` are two routes and not one endpoint taking a boolean.**
A single `POST /armed {armed: true|false}` would have to be gated for the `true`
case, and gating it gates the `false` case with it — putting authentik in front
of the veto. Splitting them is what lets the asymmetry be expressed in routing
rather than in a body check that a future edit could quietly drop: **every path
that reduces access is cheap to reach, every path that increases it is
expensive.** That asymmetry is the whole reason it is safe to hang a security
control off a third-party service like Discord. Do not merge these two routes.

Add `/api/face/enrol*`, `/api/face/subjects*` and `/api/face/arm` to the
`@admin_any` matcher in **both** vhost occurrences in
`ops/iridium/nova.Caddyfile`. `authentik-sso.md` owns the authoritative
inventory of gated and never-gated routes; both lists get these entries there.

**What protects the ungated pair instead:** network binding (default-deny CIDRs,
evaluated first), the single-use nonce with a 20 s TTL, the lockout and
release-rate caps, and the `X-Nova-Face-Key` header the dashboard proxy injects
server-side. Not the origin check — see above.

**Enrolment must happen from the tailnet origin**
(`https://nova.tuatara-dory.ts.net`), for two independent reasons that happen to
agree:

1. Both LAN vhosts import `config_gate_denied`, a flat 403 with no login path
   (`authentik-sso.md` §Gated surface). There is no way to satisfy an
   authentik gate from the LAN origin, by design.
2. `getUserMedia` needs a secure context. The Tailscale certificate is publicly
   trusted; the LAN identity is plain HTTP or a household-CA cert. On the LAN
   origin the camera API is simply absent.

Nocturnium joined the tailnet on 2026-09-02 (`--accept-dns=false`, so its LAN
dashboard routing is untouched), which is what makes the kiosk able to reach
that origin at all.

## Discord veto contract

Implemented in `nova-module-discord` — a separate public repo. No token, no ids,
no household names committed. It reuses `openDmChannel`/`sendMessage`/
`ackInteraction` in `src/discord/rest.ts` and the TTL + Confirm/Cancel shape of
`ProposalStore` in `src/inbound.ts`, which is already the veto shape: a
server-side record keyed by interaction custom id, expiring on its own, edited
into the message after every outcome so the DM history is the audit trail.

### Account mapping

`module.json` `configSchema` gains an `accounts` array. The existing top-level
`handle`/`userId` stay as they are for the inbound-command path; this is a
separate mapping because the veto needs to reach *the subject's* account, not
the module owner's.

```json
{
  "accounts": [
    {
      "discordHandle": "antidamage",
      "discordUserId": "…resolved on first connect…",
      "authentikUsername": "…"
    }
  ]
}
```

| field | meaning |
|---|---|
| `discordHandle` | Username without the `@`. Human-entered; resolved to an id once. |
| `discordUserId` | The snowflake. **This is the only field an interaction is authorised against.** A handle can be changed by its owner; an id cannot. |
| `authentikUsername` | The authentik account the face subject maps to. Revocation terminates this user's sessions. |

A face subject with no matching row gets **no** DM and **no** signature: an
unvetoable release is not a release. That is a refusal with
`reason: no_veto_channel`, not a silent success.

### The hook

The face service calls `face.session.opened` after a successful signature and
before returning the assertion to the browser. Failure to deliver the DM is
logged and does not block the response — a Discord outage must not become a
household lockout — but it is recorded in `attempts` as an undelivered veto.

```json
{
  "hook": "face.session.opened",
  "subject": "<subject id>",
  "authentikUsername": "<mapped user>",
  "sessionId": "<authentik session id, once known>",
  "clientIp": "192.168.8.x",
  "surface": "kiosk | browser | satellite",
  "at": "2026-09-02T04:05:06Z",
  "vetoId": "<opaque id, keys both buttons and the fallback link>",
  "fallbackUrl": "https://nova.tuatara-dory.ts.net/face/veto?…&sig=…"
}
```

### The two actions

| button | custom id | effect |
|---|---|---|
| **Revoke this session** | `face-veto:revoke:<vetoId>` | Terminates that authentik session via the authentik API. Leaves face login armed. |
| **Disarm face login** | `face-veto:disarm:<vetoId>` | Sets `armed = false` on the face service. Every face release stops until re-armed from a password + TOTP session. Does not by itself kill the open session — press both if both are wanted. |

Both are revocations. There is no third button.

The interaction handler compares the pressing user's id against
`accounts[].discordUserId` for the account the DM was addressed to, and drops
anything else with a log line. A stale `vetoId` edits the message to say the
veto expired rather than failing silently.

### The fallback link

`GET /face/veto?a=<revoke|disarm>&v=<vetoId>&e=<expiry epoch>&sig=<hmac>`, on the
tailnet origin. `sig` is HMAC-SHA256 over the whole query string with
`NOVA_FACE_HOST_SECRET`, compared with `hmac.compare_digest`. Single use —
consumed by the same atomic-`UPDATE`-rowcount discipline as the nonce — and
expired after `FACE_VETO_LINK_TTL_SECONDS`.

It is safe to leave ungated because it can only revoke. A leaked link disables
face login; it cannot enable one, cannot enrol, and cannot clear a lockout.

---

# The face pipeline

Unchanged by the passkey redesign. Detection, liveness and matching are already
built in `core.py`/`test_core.py` (24 tests passing) and this section describes
what exists.

## Models and pipeline

| stage | model | artefact |
|---|---|---|
| detect | RetinaFace `det_10g` (insightface `buffalo_l` detection module) | bbox, det score, 5 landmarks |
| embed | ArcFace `w600k_r50` | 512-d, L2-normalised |
| anti-spoof | MiniFASNet V2 (`2.7_80x80`) + V1SE (`4_0_0_80x80`), Silent-Face | live/spoof score in [0,1] |

Runtime is `onnxruntime-gpu`, provider list `CUDAExecutionProvider` then
`CPUExecutionProvider`. The fallback is required, not decorative: on Iridium the
LLM and TTS own most of the VRAM, and the documented eviction order evicts TTS
first — the face service must never be a thing that has to die for a voice turn.
CPU inference on a ~25-frame clip is seconds rather than hundreds of milliseconds,
which is acceptable for an interactive login and not acceptable silently, so
`/healthz` reports the provider actually in use. A degraded service is visible.

Weights are baked into the image at build time, fetched by pinned URL and
verified with `sha256sum -c`. No first-run download on the host, no runtime
network dependency, and no possibility of the service starting with a different
model than it was tested with.

| weight | sha256 |
|---|---|
| `2.7_80x80_MiniFASNetV2.pth` | `a5eb02e1843f19b5386b953cc4c9f011c3f985d0ee2bb9819eea9a142099bec0` |
| `4_0_0_80x80_MiniFASNetV1SE.pth` | `84ee1d37d96894d5e82de5a57df044ef80a58be2b218b5ed7cdfd875ec2f5990` |

## Thresholds

All named, defaulted, env-overridable, read once at startup. `core.py` takes each
one as a keyword argument carrying the same default, so a test can pin a
threshold without touching process state.

| name | default | rationale |
|---|---|---|
| `FACE_DET_SCORE_MIN` | 0.70 | RetinaFace's own confidence. Below this the landmarks are unreliable and the residual maths becomes noise. |
| `FACE_BOX_MIN_PX` | 96 | Shorter side of the bbox. ArcFace input is 112×112; a face smaller than this is upsampled and its embedding drifts. |
| `FACE_MATCH_COSINE` | 0.42 | Cosine on L2-normalised ArcFace vectors. Conventional operating point for `w600k_r50`; the gallery is tiny (one household), so a high threshold costs little. **Calibrate on real data.** |
| `FACE_MATCH_MARGIN` | 0.06 | Runner-up margin. Reject on ambiguity, never pick a winner. |
| `FACE_MIN_AGREEING_FRAMES` | 12 | Of ~25 sampled. A majority, so one well-timed bad frame cannot carry the decision. |
| `FACE_LIVENESS_RESIDUAL_MIN` | 0.012 | IOD-normalised RMS. **Guess. Calibrate on real data** — see Calibration. |
| `FACE_LIVENESS_RESIDUAL_MAX` | 0.080 | Above this the landmark track is incoherent (motion blur, tracking failure, two faces swapping). Not "very alive" — untrustworthy. |
| `FACE_LIVENESS_MIN_FRAMES` | 15 | Usable frames after detection filtering. Fewer and the reference shape is fitted to too little data. |
| `FACE_ANTISPOOF_MIN` | 0.85 | Mean live-score across usable frames. **Guess. Calibrate on real data.** |
| `FACE_CLIP_MIN_SECONDS` | 0.8 | Below this there is not enough time for a blink or a micro-expression. |
| `FACE_CLIP_MAX_SECONDS` | 2.5 | Bounds decode cost and discourages submitting a long recording. |
| `FACE_CLIP_MIN_FPS` | 20 | Non-rigid motion at 10 fps is aliased into apparent rigidity — a real face then reads as rigid, and the gap the residual threshold sits in narrows. |
| `FACE_CLIP_MAX_BYTES` | 8 MiB | Upload bound, enforced before the body is read. |
| `FACE_NONCE_TTL_SECONDS` | 20 | Long enough to record and upload 1 s of video; short enough that a stolen nonce is worthless. |
| `FACE_SESSION_TTL_SECONDS` | 60 | Face-session token. Single use, consumed by the assertion. |
| `FACE_ENROL_CENTROID_MAX` | 0.30 | Cosine distance from the running centroid an enrolment embedding may sit at. |
| `FACE_ENROL_MIN_CLIPS` | 5 | Minimum accepted clips before a subject is usable. |

Decision shape mirrors `reference_identity()` (`camera-events/service.py:782`):
top score, runner-up, threshold, and a margin — so the tuning story is one the
household already knows.

## Liveness — the landmark-variance test

Per frame, RetinaFace gives 5 points: two eye centres, nose tip, two mouth
corners. The clip's reference shape is a **per-landmark median taken in
eye-normalised coordinates**, and every frame is fitted onto it with a
similarity transform (Umeyama/Procrustes — scale, rotation, translation, no
shear, no reflection). The residual left after that rigid motion is removed,
normalised by inter-ocular distance, is the liveness signal.

**Why the median is taken in canonical coordinates, not in the image frame.**
The previous wording said "per-landmark median shape", which taken literally
means a coordinate-wise median of raw image-frame landmarks. That does not give
an invariant residual, because a coordinate-wise median is not
rotation-equivariant: `median(R·X) ≠ R·median(X)`. Rotating the whole clip
therefore moves the reference in a way no similarity fit can undo, and the
camera's orientation leaks into the number that is supposed to measure facial
motion. `core.py` canonicalises each frame first — `canonical_shape()` places the
eyes at `(±0.5, 0)` by closed form, not by a fit — and takes the median there.
The reference then has inter-ocular distance 1 by construction and the residual
is exactly invariant. This is not a refinement; the unfixed version broke
rotation invariance by 1.6e-4, which is an eighth of `RESIDUAL_MIN` and would
have shifted the live/spoof boundary with the camera's roll angle.

`fit_similarity()` guards against reflection for a related reason: a plain SVD
solution may pick a mirrored rotation, and a mirrored face fits its own mirror
image perfectly. Left unguarded, the residual — the whole signal — is driven to
zero by exactly the kind of geometric trick a spoof produces.

A photo, held still, tilted or waved, is rigid under similarity motion and
produces near-zero residual. A live face produces measurable residual from
blink, micro-expression and out-of-plane parallax. The per-landmark breakdown is
logged alongside the aggregate: on a live face the eye points should dominate,
and a clip whose residual is carried entirely by the mouth corners is worth
looking at.

**What this does not catch: a video replay on a screen is not geometrically
rigid.** A recording of a real face played on a phone produces the same
non-rigid landmark motion the real face did, and will pass the residual test.
That is not a tuning problem, it is what the test measures. The nonce and the
anti-spoof texture model exist because of it — the residual does not stand alone
and must never be presented as if it does.

Both signals enforce. Every raw score from every signal is written to `attempts`
on every attempt, pass or fail, so thresholds are tuned from logs rather than
guessed a second time.

### Calibration

`FACE_LIVENESS_RESIDUAL_MIN` and `FACE_ANTISPOOF_MIN` are guesses. Shipped
uncalibrated, the likely failure is false rejection of a real face — a still
subject on a low-motion clip lands near `RESIDUAL_MIN`, and MiniFASNet's live
score depends on the camera and lighting, both of which are fixed and specific
here (Nocturnium's UVC webcam, indoor light).

`FACE_LOCKOUT_FAILURES` and `FACE_LOCKOUT_GLOBAL_FAILURES` are also unmeasured,
and their calibration data is the same table.

Procedure, run after deploy and before the credential is registered:

1. Collect at least 20 live attempts against the real kiosk camera across the
   lighting the room actually has, plus the spoof set from the acceptance gate —
   printed photo and phone-screen replay, each still, tilted and waved.
2. Read the scores back:
   `SELECT decision, reason, residual, antispoof, agreeing_frames, usable_frames FROM attempts ORDER BY created_at DESC;`
3. Set each threshold in the gap between the two populations, not at the edge of
   either. If the live minimum and the spoof maximum overlap at all, the
   threshold is not the problem — record it and do not ship on that signal alone.
4. Set `FACE_LOCKOUT_FAILURES` above the observed per-session refusal count for a
   legitimate user in the worst lighting, and confirm it is still well under the
   attempt count a spoof-tuning run needs.
5. Write the chosen values into `/etc/nova-face-auth.env` and restart the unit.
   No code change; these are env vars precisely so calibration is an ops action.

Record the measured populations in this file when they exist, replacing the
"guess" marks above.

## Orientation

Clips are rotated upright before anything judges them. The eye landmarks are
the only orientation cue that survives a `MediaRecorder` re-encode — the
bounding box carries no rotation and the container flag is exactly what was
lost. Orientation is decided ONCE, from the first frame with a confident
detection, and applied to the whole clip: a rotation appearing halfway through
would read to the liveness residual as motion that never happened.

**Added 2026-09-04 — the no-detection case.** That check can only correct a
rotation it can *see*, and it sees nothing until a face is detected. Fine for a
phone, which is off by a quarter turn at most and still detects. Not fine for a
camera mounted on its side, where rotation decides whether there is a detection
**at all** and the clip is refused `no_face` for a face plainly in the frame.

So when no frame yields a confident detection at the incoming orientation, the
other three cardinal orientations are probed before giving up — one frame each,
and only on that path. A clip that detected normally costs nothing extra, and
the worst case is three extra detections on a clip that was going to be refused
anyway. The probe rotation and the landmark correction compose by addition
mod 4, which is why both use the same `QUARTER_TURN` map.

This is a safety net for callers whose mounting is unknown. A caller that knows
its own camera is sideways should still rotate at capture, as the kiosk witness
does — see `kiosk-attribution.md`.

## Replay defence

`POST /challenge` issues a 32-byte nonce, `FACE_NONCE_TTL_SECONDS` TTL, stored in
SQLite. The clip is submitted with the nonce. The nonce is consumed atomically —
`UPDATE challenges SET used_at=? WHERE nonce=? AND used_at IS NULL`, decision made
on `rowcount`, so two concurrent submissions of the same nonce cannot both win —
and is bound into the resulting face-session token. A recorded clip cannot be
resubmitted. Expired and used rows are swept opportunistically on issue.

The nonce is not embedded in the video and nothing proves the clip was recorded
after the nonce was issued. It bounds reuse of one captured clip; it does not
prove freshness of capture. A fresh nonce with a replayed clip has to be caught
by the anti-spoof model, which is why the acceptance gate tests exactly that
case and treats the result as the honest measure of the design.

Note the two distinct nonces in the ceremony: the **face nonce** issued by
`/challenge` (replay defence for the clip) and the **WebAuthn challenge** issued
by authentik (replay defence for the assertion). They are unrelated and neither
substitutes for the other.

## Gallery and enrolment

Own SQLite at `/data/faces.sqlite3`, WAL, `Store` class and column-migration loop
in the shape of `camera-events/service.py:164-226` — `CREATE TABLE IF NOT EXISTS`
for the base schema, then a `PRAGMA table_info` read and an `ALTER TABLE` per
missing column, so a schema addition never needs a data wipe.

| table | holds |
|---|---|
| `subjects` | id, name, created_at, thumbnail path, enabled |
| `face_embeddings` | subject_id, 512-d vector, det score, box size, capture metadata, created_at |
| `challenges` | nonce, issued_at, expires_at, used_at |
| `face_sessions` | token, subject_id, nonce, issued_at, expires_at, used_at |
| `attempts` | nonce, created_at, decision, reason, residual, antispoof, agreeing_frames, usable_frames, subject_id or null, top score, runner-up, elapsed_ms, endpoint, client_ip, authentik_session_id |
| `credentials` | subject_id, rp_id, credential_id, sealed private key, sign_count, created_at |
| `lockouts` | scope (`subject:<id>` or `global`), failure count, window_start, armed, disarmed_at, disarmed_by, cleared_at, cleared_by |
| `vetoes` | veto_id, subject_id, authentik_session_id, issued_at, expires_at, used_at, action, actor |

`armed` lives in `lockouts` under the `global` scope rather than in a config file,
so disarming is one durable write and survives a restart.

Enrolment takes a minimum of `FACE_ENROL_MIN_CLIPS` (5) clips at different
angles. Each clip passes the **same liveness gate as authentication** — an
enrolment path that skips liveness is a path to enrolling a photograph, and the
gallery it builds then authenticates one.

Intra-subject consistency, checked per accepted clip:

- every accepted embedding within `FACE_ENROL_CENTROID_MAX` (0.30) cosine
  distance of the running centroid of the ones already accepted; and
- no accepted embedding within `FACE_MATCH_COSINE` of a **different** existing
  subject — otherwise two household members' galleries overlap and neither can be
  matched unambiguously afterwards.

A rejected clip names the offending index and the reason. When the offending
index is not the candidate, the existing gallery is the problem and re-recording
will not fix it. The subject stays unusable until 5 clips are accepted.

**Raw enrolment frames are not retained.** Embeddings, plus one 256 px thumbnail
per subject for the gallery UI. A 512-d ArcFace vector is not reversible to a
photograph; a directory of face crops is a different liability, and there is no
feature that needs it.

## API surface

Every endpoint requires `X-Nova-Face-Key`, `/healthz` included — an
unauthenticated health endpoint here would advertise how many people are
enrolled and which provider is live. See [Key handling](#key-handling) for who
may hold that key.

| method | path | gate | body | returns |
|---|---|---|---|---|
| `GET` | `/healthz` | key | — | `{ok, provider, models:{det,rec,antispoof}, subjects, armed, version}` |
| `POST` | `/challenge` | key + network | — | `{nonce, expiresAt}` |
| `POST` | `/detect` | key | multipart image | `[{bbox, score, landmarks}]` |
| `POST` | `/embed` | key | multipart image | `{embedding[512], bbox, score}` |
| `POST` | `/identify` | key | multipart clip **or** image | `{subject, score, runnerUp, frames}` — recognition only, no liveness, no token |
| `POST` | `/verify` | key + network + armed | multipart `clip` + `nonce` | `{subject, faceSession, expiresAt, signals:{…}}` |
| `POST` | `/assert` | key + network + armed | multipart `clip` + `nonce` + `challenge` | `{subject, credentialId, clientDataJSON, authenticatorData, signature, userHandle}` |
| `POST` | `/arm` | key + **authentik session** | — | `{armed: true}` — password + TOTP only |
| `GET` | `/veto` | HMAC + single use | query | `{action, applied}` |
| `POST` | `/enrol/{subject}` | key + **authentik session** | multipart `clip` | `{accepted, clipsSoFar, needed, remaining, consistency, reason?}` |
| `GET` | `/subjects` | key + **authentik session** | — | `[{id, name, clips, ready, thumbnailUrl, createdAt}]` |
| `DELETE` | `/subjects/{id}` | key + **authentik session** | — | removes subject, embeddings, credentials |

`/verify` (face only, no signature) and `/assert` (face + signature) stay
separate so the recognition half is usable by camera-events and the kiosk
without touching auth. `/identify` is deliberately liveness-free and token-free
and is never sufficient to let anybody in.

`/auth/face` from the previous pass is **retired**. It made the service a
flow-driving WebAuthn client; the ceremony now has the browser drive the flow.

`/assert` is `/verify` plus signing, in one call: the face session is minted and
spent inside the request, never handed to a caller. `challenge` is the
base64url WebAuthn challenge exactly as authentik issued it.

Clip handling, every clip endpoint: reject on `Content-Length` above
`FACE_CLIP_MAX_BYTES` **before** reading the body, and cap the streamed read at
the same bound in case the header lied; write to a temp file; open with
`cv2.VideoCapture`; reject on duration or fps outside bounds; sample ~25 frames
evenly. Delete the temp file in a `finally` — an exception mid-decode must not
leave a video of somebody's face on disk.

Every `/verify` and `/assert` attempt writes an `attempts` row — nonce, decision,
every signal score, subject or null, client IP, timing — success and failure
alike. This is both the audit trail and the calibration data set.

## Key handling

**Browsers never hold `X-Nova-Face-Key`.** A key shipped to a browser is a key on
every device that loads the page, in every devtools network pane and every
`localStorage` dump. There is no browser-side storage that fixes this.

| client | route | key |
|---|---|---|
| Browser (kiosk, config page, login) | same-origin `/api/face/*` on the dashboard | injected server-side by `lib/face-auth-client.ts`, stays in the Next.js process |
| Non-browser LAN (satellites, camera-events, scripts) | `http://iridium:8099` direct, or `https://nova.…/face/*` through Caddy | held in the caller's own env/secret file |

The dashboard proxy follows `lib/camera-events-client.ts` exactly: a
`faceAuthFetch(path, init)` reading `NOVA_FACE_AUTH_URL` (default
`http://127.0.0.1:8099`) and `NOVA_FACE_KEY` from the server environment, and a
`proxyFaceJson` that forwards status and body and turns a connection failure into
a `503` with a message rather than an unhandled exception. Multipart bodies are
streamed through; the proxy does not buffer an 8 MiB upload into memory to
re-encode it.

The Caddy route follows the `/internal-llm/*` pattern from `nova.Caddyfile:39-45`:

```
@face path /face/*
handle_path /face/* {
    @authed header X-Nova-Face-Key "{$NOVA_FACE_KEY}"
    @unauthed not header X-Nova-Face-Key "{$NOVA_FACE_KEY}"
    reverse_proxy @authed 127.0.0.1:8099
    respond @unauthed 403
}
```

**The quotes are load-bearing.** Unquoted, `{$NOVA_FACE_KEY}` substitutes to
nothing when the env var is unset, leaving `@authed header X-Nova-Face-Key` —
the one-argument form, which matches the header with *any* value — and
`caddy validate` passes. The matcher fails open silently. The existing
`NOVA_LLM_KEY` route has the identical defect and needs the same one-character
fix; that is pre-existing and tracked separately.

`{$NOVA_FACE_KEY}` is a Caddyfile env substitution, appended by hand to
`/etc/nova-caddy.env` — never a literal, for the reason documented at
`nova.Caddyfile:19-38`. Caddy's check is perimeter convenience; the service
enforces the same header itself, so the LAN port is not open even when Caddy is
bypassed.

Service-side: auth middleware runs **first, before anything touches the request
body**, comparing with `hmac.compare_digest`. Missing `NOVA_FACE_KEY` at startup
means refuse to boot — there is no default key and no unauthenticated mode.

The key must never leave Iridium. The deploy's readiness probe reads it from the
host's own `/etc/nova-face-auth.env` inside the remote shell, passed to `curl`
via stdin/`--config` rather than argv (argv is world-readable in `/proc` for the
life of the process), and `deploy-nova-stack.ps1` carries **no** workstation-side
key probe — that would send the key over cleartext HTTP on a WiFi-only LAN and
put a second copy on a Windows box.

## Failure modes and refusals

| condition | response | why |
|---|---|---|
| Caller outside `FACE_ALLOWED_CIDRS` | `403`, `reason: network_denied` | Evaluated before any model runs. |
| `armed = false` | `403`, `reason: disarmed` | Clearable only from a password + TOTP session. |
| Lockout window exceeded | `429`, `reason: locked_out` | Sets `armed = false` as it trips. |
| Release rate exceeded | `429`, `reason: rate_limited` | Also sets `armed = false` — treated as an attack signal. |
| No face found | `422`, `reason: no_face` | |
| **Several faces in frame** | `422`, `reason: multiple_faces` | Never authenticate a crowd. There is no "pick the biggest" rule — one of the others may be the one being coerced past the camera. |
| Detection below `FACE_DET_SCORE_MIN` or box below `FACE_BOX_MIN_PX` | `422`, `reason: low_detection` / `face_too_small` | |
| Clip shorter/longer than bounds, or fps below `FACE_CLIP_MIN_FPS` | `422`, `reason: clip_too_short` / `clip_too_long` / `clip_low_fps` | |
| Fewer than `FACE_LIVENESS_MIN_FRAMES` usable frames | `422`, `reason: too_few_frames` | Named by dominant cause when the frames agree on one. |
| Residual below `RESIDUAL_MIN` | `401`, `reason: liveness_rigid` | |
| Residual above `RESIDUAL_MAX` | `422`, `reason: liveness_unstable` | Unstable is not alive. |
| Anti-spoof below `FACE_ANTISPOOF_MIN` | `401`, `reason: antispoof` | |
| Ambiguous match (within `FACE_MATCH_MARGIN`) | `401`, `reason: ambiguous` | |
| Fewer than `FACE_MIN_AGREEING_FRAMES` agreeing | `401`, `reason: too_few_agreeing` | |
| Nonce expired or already used | `401`, `reason: nonce_invalid` | |
| Subject has no mapped Discord account | `403`, `reason: no_veto_channel` | An unvetoable release is not a release. |
| Upload over `FACE_CLIP_MAX_BYTES` | `413` | Checked before the body is read. |
| Missing/incorrect header | `403` | Including on `/healthz`. |
| Anti-spoof weights missing | container exits at startup; `/healthz` never becomes `ok` | **Never fail open.** A service that cannot detect a photo must not serve. |
| GPU busy | `200`, `provider: CPUExecutionProvider` | Slower, still answers. |
| authentik unreachable | `503` | No local fallback session. A service that mints its own session when the identity provider is down is not an authentication system. |
| Discord unreachable | `200`, veto logged as undelivered | A third-party outage must not lock Adeline out of her own house. |

A refusal names its reason in a stable machine-readable string. The UI renders
these.

## Enrolment UI contract

Enrolment lives **inside `app/components/UserDataConfig.tsx`, beside
`SpeakerProfilesConfig`** — household people and the identities recognised
against them is exactly that section's remit, and face is the visual twin of the
voice profiles already there. It calls the same-origin `/api/face/*` proxy routes
only, and reuses `ConfigAccordion`, `MomentaryFeedbackButton` and
`ConfirmDialog` per `nova-ha-dashboard/CLAUDE.md`. No raw inputs, no unstyled
buttons.

**`getUserMedia` requires a secure context**, and the enrolment routes require an
authentik session, and both are only available on the tailnet origin
(`https://nova.tuatara-dory.ts.net`). On the LAN origin the camera API is absent
and the routes 403. Detect it with `window.isSecureContext` and render the
reason rather than failing silently.

Capture: `getUserMedia({video: {width: 1280, height: 720, facingMode: "user"}})`,
`MediaRecorder` with `video/webm`, `stop()` on a 1000 ms timer, one `Blob` per
clip posted as `multipart/form-data` field `clip`. Device selection must not bind
`/dev/video4` on Nocturnium.

Flow per clip: `POST /api/face/challenge` → nonce; record 1 s; `POST
/api/face/enrol/{subject}` with `clip` and `nonce`.

Progress semantics come from the response, not from a client-side counter — a
rejected clip must not advance the count:

```json
{ "accepted": true, "clipsSoFar": 3, "needed": 5, "remaining": 2,
  "consistency": { "centroidDistance": 0.14, "nearestOtherSubject": 0.31 } }
```

`remaining` is what the UI displays. `accepted: false` carries `reason` and
leaves `clipsSoFar` unchanged.

Angle guidance, one line shown per clip index, in order:

| clip | prompt |
|---|---|
| 1 | Look straight at the camera. |
| 2 | Turn your head slightly left. |
| 3 | Turn your head slightly right. |
| 4 | Tilt your chin up a little. |
| 5 | Tilt your chin down a little. |

Beyond 5 the prompt is "One more from any angle." The angles exist so the gallery
covers the head poses the kiosk camera actually sees; five frontal clips enrol a
subject who fails the moment they turn their head.

Error strings the UI must be able to render — the `reason` values from the table
above, plus:

| reason | shown |
|---|---|
| `no_face` | No face found in that clip. |
| `multiple_faces` | More than one face in frame. |
| `face_too_small` | Move closer to the camera. |
| `clip_too_short`, `clip_low_fps` | The clip was too short or too choppy. Try again. |
| `liveness_rigid` | That did not look like a live face. |
| `liveness_unstable` | Too much movement. Hold steadier. |
| `antispoof` | That did not look like a live face. |
| `inconsistent` | That clip does not match the others. Not counted. |
| `conflicts_with_subject` | That face is already enrolled as someone else. |
| `nonce_invalid` | The capture expired. Try again. |
| `network_denied` | Face login is not available from this network. |
| `disarmed`, `locked_out`, `rate_limited` | Face login is switched off. Sign in with your password to turn it back on. |
| `no_veto_channel` | This person has no Discord account mapped. Face login is unavailable for them. |
| `insecure_context` | Camera access needs the HTTPS address. |
| `service_unavailable` | The face service is not responding. |

`liveness_rigid` and `antispoof` deliberately show the same text. The user gets
no feedback about which signal caught them; the distinction is in `attempts`
where it is useful, not in the UI where it is a tuning aid for an attacker. The
three lockout reasons collapse to one string for the same reason.

## Deployment

`ops/iridium/nova-face-auth.service`, modelled on `nova-camera-events.service`,
`--network host --gpus all --memory=6g --shm-size=1g`, data at
`/opt/nova-ha-dashboard/data/face-auth:/data`, and:

```
ExecStartPre=/usr/bin/test -f /etc/nova-face-auth.env
```

That line is deliberate. No secret file, no service — never a default key.

Port 8099. 8098 is camera-events; 8095-8097 are free.

**Restart policy and ordering.** `Restart=on-failure` with a start limit, **not**
`Restart=always`. Iridium is 15.4 GB with a documented hard-hang history and
4.4 GB already in swap; `--memory=6g` plus `Restart=always` turns an OOM into a
restart loop that reloads three models on every iteration. Order the unit
*after* the voice stack rather than racing it at boot, and add the measured
figure to `authentik-sso.md`'s RAM budget section. Nova's stability outranks
this feature: if `free -m` before start does not leave the voice stack's
`nova-mem-gate 3584` headroom intact, do not start the service.

**A failed face build must not kill the dashboard deploy.** The block sits after
the container swap and before the Caddy install, under `set -euo pipefail`; a
flaked weight download or a slow first warm-up would otherwise abort the deploy
with new code on disk and Caddy never reloaded. Build and readiness are
non-fatal, with a loud warning.

`deploy-nova-dashboard.ps1` gains the block beside the camera-events one: build
`nova-face-auth:local`, install the unit, `enable`/`restart`, then a readiness
loop on `/healthz` with the key read from the host's own env file inside the
remote bash (see Key handling for the argv rule). The whole block is guarded on
the env file existing, with a loud skip rather than a failed deploy on an
unprovisioned host.

`/face/*` is excluded from the plain-HTTP `:80` vhost. The key would otherwise
cross a WiFi-only LAN in cleartext.

## Secrets and the public remote

The dashboard repo pushes to public GitHub. Nothing under `face-auth/` may
contain:

- a key or secret of any kind — `NOVA_FACE_KEY`, `NOVA_FACE_HOST_SECRET`;
- a host address — no `192.168.8.x`, no `iridium`, no `nocturnium`, no tailnet
  name, in code or defaults;
- a household name — subject names are data in SQLite, never fixtures, never test
  constants;
- a Discord id, handle or token — those live in `nova-module-discord`'s own
  config, which is also a public repo and subject to the same rule;
- model weights — fetched at build time by pinned URL with `sha256sum -c`, so the
  repo carries the hash and the URL, not the binary.

All of it lives in `/etc/nova-face-auth.env`, created out of band, holding
`NOVA_FACE_KEY`, `NOVA_FACE_HOST_SECRET`, `AUTHENTIK_BASE_URL`,
`AUTHENTIK_*_FLOW`, `WEBAUTHN_RP_ID`, `WEBAUTHN_ORIGIN`, `FACE_ALLOWED_CIDRS`,
plus any calibrated threshold overrides. Check against the PRIVATEREF scrub rules
before the first commit. Commit inside `nova-ha-dashboard/` — it is a nested repo.

The host addresses in this spec are the exception the scrub rules already make
for `specs/`; the constraint above is about shipped code and defaults.

## Later, not now

`camera-events`' `owner_identity()` (`service.py:806`) could call `/identify`
instead of comparing DINOv2 whole-body embeddings, giving owner suppression a far
better signal. Design for it — `/identify` is deliberately liveness-free and
token-free so a background analysis pass can use it — but do not build it in this
pass. Camera-events would need the key in its own env file and a fallback for when
the face service is down, and neither is in scope here.

Out of scope entirely: enrolling anyone outside the household, and any use of
this service to identify people who have not consented to enrolment.

## Done means

- `python -m unittest discover -v` passes in `face-auth/`, including: a rigid
  synthetic landmark track fails the residual test; an injected non-rigid track
  passes; the residual is invariant to global scale, rotation and translation
  (three separate assertions — the whole design rests on this); a pure-noise track
  is rejected as unstable rather than accepted as alive; `cosine_match` returns
  `None` inside the margin; `aggregate_frames` refuses 11 of 25 and accepts 12;
  `enrolment_consistency` names the offending index; network binding refuses an
  address outside the CIDR list and a malformed list refuses everything; the
  lockout state machine trips at N and does not clear on restart; an expired or
  reused face-session token cannot sign; one nonce cannot mint two signatures;
  the signature counter increments and persists.
- `/healthz` reports models loaded and the active provider; the same call without
  the header returns 403.
- Adeline enrols from 5 clips at different angles from the kiosk browser on
  Nocturnium, **from the tailnet origin behind a password + TOTP session**. A
  LAN-origin enrolment attempt is refused.
- `/identify` on a live clip returns the right subject; on a different person
  returns no match rather than a wrong match; two faces in frame is a refusal.
- **The spoof gate.** A phone showing a recorded clip and a printed photo, each
  held still, tilted and waved, are all rejected, and the logged scores sit
  clearly below the live population. A thin margin means recalibrate from
  `attempts`, not ship.
- A successful clip resubmitted fails on the nonce. Resubmitted with a fresh
  nonce it still fails, and the recorded reason says which signal caught it. That
  second result is the honest measure of this design.
- **End to end**: face → assertion → authentik session cookie in the browser,
  estate-wide, against `harness.py` first and then real authentik.
- Each control verified independently: an off-network caller is refused; N
  failures lock out and a face cannot clear it; the Discord DM arrives with
  working Revoke and Disarm; a press from a non-mapped Discord account does
  nothing and is logged; the fallback link works once and not twice.
- Voice stack unaffected: `free -m` and `nvidia-smi` headroom before and after
  warm-up, and a voice round trip with the face service warm.
</content>
</invoke>
