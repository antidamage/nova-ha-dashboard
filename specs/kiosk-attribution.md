# Kiosk attribution — who touched the wall panel

Produced by plan `we-need-to-theme-cozy-eich`
(`~/.claude/plans/we-need-to-theme-cozy-eich.md`), 2026-09-03.

Related:

- [`face-auth.md`](face-auth.md) owns the face service. This spec is a consumer
  of its `POST /identify` endpoint and changes nothing about it.
- [`bedroom-heater-control-integrity.md`](bedroom-heater-control-integrity.md)
  §4 introduced `callerAttribution()` and scoped it to two routes. This spec
  widens that scope and is the reason §4's inventory is now stale.

## Why

Nocturnium is a shared wall panel with no login and no way to have one — both
LAN vhosts answer `config_gate_denied`, a flat 403 with no login path, and the
kiosk browser runs on a plain-HTTP LAN origin where `getUserMedia` does not
exist. Anyone in the house can walk up and change anything.

The attribution that exists records an IP and a user agent
(`lib/request-attribution.ts`), which for the kiosk is the same on every tap. It
answers "which machine" and never "which person". That was enough for the
incident it was built for — the bedroom heater running at a target nobody set —
because the question there was whether a client had written at all. It is not
enough for the question now being asked.

Adeline: *"make a service available to passively log from nocturnium who changes
a control. so if nocturnium itself is used, tell me who it may have been, if
they're known."*

Note the phrasing. **"Who it may have been", "if they're known."** This is a log,
not a gate, and it is allowed to answer "I do not know".

## Consent scope

Enrolled household members only, and enrolment is consenting by construction —
it requires five deliberate clips from an authenticated session. `/identify`
returns `null` for a face it does not recognise and never a nearest neighbour,
so there is no path here to identifying anyone who has not enrolled. This is the
same boundary `face-auth.md` draws, and it is not widened.

An unidentified session is recorded as unidentified. It is never guessed at, and
the presence of an unknown person is not itself an event worth reporting beyond
the fact that a control changed.

## What is deliberately not built

**Refusing input.** Adeline: *"we'll eventually prevent input by people who
aren't me."* Eventually. This pass records; it does not refuse. The observation
join is the input a later gate would read, and that is the whole of the
preparation — no half-built switch, no disabled flag, nothing to accidentally
turn on.

---

# The witness

## Where it runs, and why it is a daemon

On Nocturnium, as a systemd unit, reading `/dev/video0` directly.

Not in the kiosk browser, and the reason is not preference. The kiosk launches
Brave against `NOVA_BACKEND_URL`, a plain-HTTP LAN origin
(`ops/kiosk/brave-kiosk-launch.sh`). `getUserMedia` requires a secure context and
is simply absent there. Even on the tailnet origin it would need a standing
camera permission on a page that reloads on every deploy.

A daemon also makes the capture genuinely passive, which is what was asked for:
it does not depend on the dashboard page being loaded, being current, or being
on the right route.

`ops/nocturnium-kiosk-witness.py` and `ops/nocturnium-kiosk-witness.service`,
modelled on the existing `ops/nocturnium-camera-proxy.py` / `.service` pair —
`User=antidamage`, `EnvironmentFile=-/etc/nova-kiosk-witness.env`,
`Restart=always`, `RestartSec=3`, and the same `NoNewPrivileges`,
`PrivateTmp`, `ProtectSystem=full`, `ProtectHome` hardening.

## The camera

**Added 2026-09-04 — a preference list, not a fixed device.** Nocturnium got a
second camera, a Microsoft LifeCam mounted upright on the panel, alongside the
built-in "USB2.0 HD UVC WebCam" mounted on its side. Which one is picked now
matters, and the answer has to be "the LifeCam, when it's there" — not a device
path, which moves every time something is plugged in or unplugged, and not a
device index, for the same reason.

`WITNESS_CAMERAS`, default `"LifeCam=0,USB2.0 HD=90"`: `name=degrees` pairs,
comma-separated, most preferred first. `resolve_camera()` walks the list in
order and takes the lowest-numbered `/dev/videoN` node whose kernel card name
(`/sys/class/video4linux/videoN/name`) contains that substring, case-insensitive
— matched by name because a camera presents several nodes (metadata, an
infrared sensor on the built-in one) and only the first is the actual image.
Resolved fresh on every capture, not once at startup, so unplugging the LifeCam
falls back on the *next touch* rather than needing a restart.

**The LifeCam needs no rotation; the built-in does.** That is the whole reason
rotation lives in the same list as the name rather than as a separate setting —
splitting them is how a camera ends up selected under one rule and rotated by
the other's.

**Never the MS2109 grabber** (`/dev/video4`/`5`, card name containing
"MACROSILICON" or "2109"). That is the grabber carrying the Outside camera,
already owned by the camera recorder; pointing the witness at it would identify
whoever walks past the front of the house rather than whoever is standing at
the panel. `face-auth.md` calls out the same trap for enrolment; it applies here
for the same reason and with worse consequences, because this runs unattended.
Checked by both device path (`WITNESS_FORBIDDEN_DEVICES`) and by name
(`WITNESS_FORBIDDEN_NAMES`) — the path check alone stops meaning anything the
moment node numbers move, which on this host is often. A configuration mistake
here is silent and privacy-relevant, so it is checked rather than documented.

The browser side reads the same shape of list — `dashboard.kiosk.cameras` in
`nova-household`'s config, surfaced to the client via `/api/config/client` — so
`pickPreferredCamera()` (face sign-in, enrolment) and the rotated preview both
pick the LifeCam the same way the daemon does, from one source of truth rather
than three separately-tuned heuristics.

## The trigger

`/dev/input/event*`, polled at 1 Hz. Any event arriving since the last poll
means somebody touched the panel.

**evdev, not XScreenSaver — settled live, 2026-09-03.** The plan proposed the
X11 idle extension with a Wayland check as a caveat. The check was run first and
the answer is Wayland: `loginctl show-session -p Type` reports `wayland` for the
kiosk session on Nocturnium, and `xprintidle` is not installed either. Both X11
routes would have failed *silently*, and a daemon that cannot see input looks
exactly like a daemon watching an empty room — the worst shape a bug can take
here, because nothing ever reports it.

evdev sits below the display server, so it works on Wayland, X11 and a bare
console alike, and does not depend on a desktop D-Bus API surviving an upgrade.
Reading an event device does **not** steal events from the compositor: each open
file description gets its own buffer, so this is a passive observer.

Devices are selected from `/proc/bus/input/devices` by their `Handlers` row
containing `mouse`, `kbd` or `js`. On this host that keeps the Melfas
touchscreen (`event4`), the wireless keyboard and the mouse, and drops the three
HD-Audio jack nodes, which also present event devices and would otherwise
register as phantom touches. Verified against the live device table rather than
assumed.

It needs the `input` group: `/dev/input/event*` is `root:input 0660` and
`antidamage` is not in it. The unit grants it with `SupplementaryGroups=input`
— to the service, not to the login account, so nothing else the user runs gains
the ability to read every keystroke on the machine.

Touch is the right trigger rather than a timer. A person at the panel is the only
thing this is trying to observe, and touching it is the only unambiguous evidence
of one.

## Sessions — the optimisation

A naive design captures on a fixed debounce, which means a person changing five
things over a minute costs three GPU inferences and produces three
indistinguishable observations. Adeline: *"first touch recognises the user, more
touches within 30 seconds are obviously them."*

So a **session** is the unit, not a touch:

- The first touch after a quiet period **opens a session** and is the only touch
  that costs a capture.
- Any touch within `KIOSK_IDENTITY_TTL_SECONDS` of the previous touch belongs to
  the same session and the same person. No camera, no upload, no GPU — the
  daemon extends the session and posts a bare touch ping.
- Once the identity TTL lapses, the next touch opens a genuinely new session with
  a fresh capture.

One `/identify` per visit rather than one every twenty seconds. On a household
panel that is the difference between a handful of inferences a day and several
hundred, on a GPU that the voice stack and the LLM already contend for.

The assumption is stated plainly because it is an assumption: a second person
stepping in within thirty seconds is attributed to the first. That is acceptable
for a log of who was at the panel in a single household, and it would not be
acceptable for a gate. If this ever becomes a gate, this is the first thing that
has to change.

### When the opening capture fails

If the first capture returns no subject — nobody in frame, a face mid-turn, bad
light — allow at most `WITNESS_IDENTIFY_RETRIES` (default 2) further attempts on
later touches in the same session, no closer than
`WITNESS_RETRY_MIN_SECONDS` (default 5) apart. Then stop trying and let the
session stand as unidentified.

Without the retry, someone who happened to look away at the moment they first
touched the panel brands their whole visit unknown. With unlimited retries, an
empty room with a flickering motion source burns the GPU indefinitely. Two is
enough for the real case and bounded for the bad one.

## The capture

~1.2 s from the camera with ffmpeg, `WITNESS_CLIP_SECONDS`. Then
`POST /face/identify` with the clip as multipart field `clip`.

**A short clip is correct here and only here.** Enrolment and `/assert` record
four seconds because they run the liveness gate, which measures non-rigid motion
and needs a window wide enough to contain a blink. `/identify` is deliberately
liveness-free and token-free — that is the whole reason `face-auth.md` kept it
separate from `/verify` — so it needs enough frames to match an embedding and
nothing more. Recognition wants a face in frame; liveness wants time. Do not
"fix" this by raising it to match the other two: it would triple the decode cost
of the most frequent call in the system for no gain.

**Delete the clip in a `finally`.** An exception mid-upload must not leave a
video of somebody's face on Nocturnium's disk. This is the same rule the face
service applies to its own temp files, and it matters more here because this runs
unattended and nobody is watching the directory.

**No image ever leaves the daemon except to `/identify`, and nothing is ever
stored.** The observation posted to the dashboard is a subject id, a score and a
timestamp.

### Orientation and frame rate — both required, both found live

Two settings the *built-in* camera needs, neither a default worth trusting. The
LifeCam needs neither — it is mounted upright and shares the built-in's frame
rate ceiling for a different reason (see below), so both settings below apply
per-camera via `WITNESS_CAMERAS`, not globally.

**Rotation.** The built-in webcam is mounted on its side: the room arrives
rotated a quarter turn anticlockwise, and a face in it is rotated with it.
Captured with `=90` in its `WITNESS_CAMERAS` entry, applied by ffmpeg's
`transpose=1`. The LifeCam's entry carries `=0` — explicitly, not by omission,
so a reader of the config sees that its lack of rotation was decided rather than
forgotten.

Corrected at capture rather than left to the service because each camera's
mounting is a fixed, known fact and a pixel rotation costs nothing here, whereas
making the service work it out costs extra detection passes on every clip. The
service keeps a fallback for callers whose orientation is unknown — see below.

**Frame rate.** Both cameras offer 1280x720 in YUYV and MJPG, and v4l2 picks
YUYV by default, which only delivers **10 fps** at that size on either of them.
`FACE_CLIP_MIN_FPS` is 20, so a clip at the default format was refused
`clip_low_fps` before a face was ever looked for. MJPG does the same resolution
at 30 fps on both cameras — verified against the LifeCam's own format table, not
assumed from the built-in's. `WITNESS_INPUT_FORMAT=mjpeg`, `WITNESS_FRAMERATE=30`
and `WITNESS_VIDEO_SIZE=1280x720` ask for it explicitly, applied to whichever
device `resolve_camera()` picked; left to negotiate, ffmpeg negotiates badly.

Verified live: the built-in's capture is 720x1280 at 30/1 after rotation; the
LifeCam resolves correctly at `/dev/video6`, unrotated, from
`WITNESS_CAMERAS="LifeCam=0,USB2.0 HD=90"`.

**A busy device is expected and harmless.** Enrolment in the browser holds the
same webcam, and ffmpeg then exits with "Device or resource busy". The daemon
logs it and drops the capture, which is the designed behaviour — the witness may
never be able to affect anything else on this host.

## Reaching the face service

`https://nova.tuatara-dory.ts.net/face/identify`, through Caddy's existing
`handle_path /face/*` route, with `X-Nova-Face-Key` read from
`/etc/nova-kiosk-witness.env`.

The tailnet route, **not** `http://192.168.8.20:8099` directly. The shared key
must not cross a WiFi-only LAN in cleartext — the same rule `face-auth.md`
applies to the deploy readiness probe, and for the same reason. `/face/*` is
excluded from the plain-HTTP `:80` vhost precisely so this cannot be done
accidentally.

Nocturnium joined the tailnet on 2026-09-02 with `--accept-dns=false`, to keep
its LAN-based dashboard routing intact. So MagicDNS does not resolve there and
the name needs an `/etc/hosts` entry; `ops/nocturnium-caddy-hosts-entry.txt` is
the existing precedent for exactly this, and the install script writes the
witness's entry the same way.

## Posting the observation

Two shapes, both to the dashboard, both LAN-reachable and ungated:

```
POST /api/kiosk/witness          { sessionId, subject, score, runnerUp, at }
POST /api/kiosk/witness/touch    { sessionId, at }
```

The touch ping carries no payload and costs nothing. It exists because the
dashboard's session clock must track **real activity**, not inferred activity: a
person who taps around without changing anything is still present, and a session
whose clock only advanced on control mutations would close underneath them.

Both routes are protected by a shared header, `X-Nova-Witness-Key`, injected by
the daemon and checked server-side. This follows the reasoning already in
`lib/face-auth-client.ts` for `X-Nova-Face-Proxy`: one credential may not vouch
for two different things, so the witness gets its own rather than reusing the
face key, which is held by every LAN service that talks to the oracle.

## Failure is silent and harmless

Every failure — camera busy, ffmpeg missing, face service down, dashboard
unreachable — is logged and dropped. The witness must never be able to affect the
kiosk, a control, or a person's ability to use the panel. A house whose lights
stop working because a camera daemon crashed is a worse house than one with an
unattributed log entry.

---

# The dashboard side

## The session record

`lib/kiosk-witness.ts`, a bounded store under `data/kiosk-witness/`, written with
the same atomic temp-file-and-rename discipline as `lib/event-spool.ts`.

```ts
type KioskSession = {
  sessionId: string;
  person: string | null;      // subject id, null when unidentified
  score: number | null;
  identifiedAt: string | null;
  openedAt: string;
  lastTouchAt: string;
  actions: KioskAction[];
  digestSentAt: string | null;
  digestRef: string | null;   // reserved; see the note under The two timers
};
```

One open session at a time, plus a capped ring of recent closed ones
(`KIOSK_ACTIVITY_RING`, default 500). Next.js runs one server process here so an
in-process cache over the file is sufficient; the file exists so a restart does
not lose the open session, and `lastTouchAt` is what lets a restarted process
decide whether to flush or resume.

## The join

`nocturniumIdentity(caller)` takes the existing `CallerAttribution` and returns:

```ts
{ person: string | null, score: number | null, sessionId: string | null,
  identifiedAt: string | null, ageSeconds: number | null }
```

`person` is `null` when the session is unidentified, when no session is open, or
when the caller is not Nocturnium. **`ageSeconds` travels with the answer** so a
stale attribution is visible in the record rather than implied by its absence —
an action attributed to an observation four minutes old is a weaker claim than
one attributed to an observation four seconds old, and the reader should be able
to see the difference.

## The two timers

Both env-overridable, read once at startup.

| name | default | meaning |
|---|---|---|
| `KIOSK_IDENTITY_TTL_SECONDS` | 30 | Rolling from the last touch. While it holds, a touch is the same person and costs no capture. |
| `KIOSK_DIGEST_QUIET_SECONDS` | 10 | A gap this long with no touch flushes the session's actions as one digest. |

They deliberately differ, and the gap between them is the interesting case.

A touch arriving fifteen seconds after a digest was sent is **outside** the
digest window but **inside** the identity window. It is the same person and the
same session. It appends to the digest already sent, by editing it, rather than
posting a second message — the same edit-the-message-into-an-audit-trail
discipline `nova-module-discord`'s `ProposalStore` already uses for proposals.
**Which side holds the message id.** The notifier does, keyed by session id,
not the dashboard. `emitModuleEvent` is fire-and-forget and has no return path,
so the dashboard cannot learn a Discord message id even in principle. What it
sends is `continuation: true`, meaning "you have already reported this visit";
the notifier looks up its own map and edits. A continuation whose original the
notifier no longer knows — it restarted, or the first send failed — posts fresh,
because duplicating a line beats losing one.

The `digestRef` field on the session record is therefore reserved rather than
load-bearing, and is currently always null. It is kept because a future notifier
that CAN report an id back (an HTTP-based one, rather than a module event) would
want somewhere to put it, and removing it later is cheaper than adding it to a
persisted record in flight. Anything reading it should treat null as normal.

Only once the identity TTL lapses does the next touch open a new session with a
fresh capture and a new digest.

**A session that accumulated no actions produces no digest at all.** Somebody
woke the panel, looked at the clock and walked away. Presence on its own is not
an event worth sending, and a notification stream that fires on it is a stream
that gets muted.

## The flush timer lives in the dashboard

Not in the daemon, because the dashboard is the only party that knows which
actions actually landed. A `setTimeout` rearmed on each touch is enough. The
session record also carries `lastTouchAt`, so a process restart mid-session
flushes on the next touch or on the next read rather than losing the digest
silently.

---

# Attribution on control routes

## The kiosk identity contract

There is none today — no `isKiosk` flag, no header, no query param. The only
signal is the caller address, which `callerAttribution()` already extracts from
`X-Forwarded-For`, `X-Real-IP` and `Forwarded`.

Nocturnium's LAN and tailnet addresses go in `nova-household`'s config, which
holds this house's own data and has no public remote, and are read through the
existing config path. **No address goes into the dashboard repo** —
`lib/no-household-data.test.ts` is a build-breaking tripwire for exactly that,
and this repo pushes to public GitHub.

Trusting the forwarded header is appropriate here for the reason
`request-attribution.ts` already documents: Caddy is the only thing in front of
the app, and Nova is a single household on a LAN plus Tailscale with no untrusted
ingress. On a public-facing service it would not be.

## One helper, every route

`attributeControl(request, {service, event, detail})` in
`lib/request-attribution.ts`:

1. `callerAttribution(request)` for ip and user agent, as today.
2. `nocturniumIdentity(caller)` for the person, when the caller is the kiosk.
3. `emitDashboardEvent` with `callerIp`, `callerAgent`, `callerPerson`,
   `callerPersonScore`, `callerPersonAgeSeconds` and `kioskSessionId` in
   `detail` — the existing route into `nova-event`, JetStream and Grafana.
4. Append the action to the open session for the digest, and to the activity
   ring.

Fire-and-forget throughout. `event-spool.ts` already states the contract — a
monitoring hiccup must never delay or fail a device command — and the witness
join inherits it.

The module event fires **once per session at flush**, not per action:

```
emitModuleEvent({ name: "kiosk.session.digest", ... })
```

carrying the person, the session id, the window and the action list. Per-action
module events would be exactly the tap-by-tap stream the digest exists to avoid.

## Route inventory

`bedroom-heater-control-integrity.md` §4 scoped attribution to
`/api/bedroom-heater` and `/api/climate-control`. That scope is superseded: "who
changed a control" has to mean any control, or the answer is misleading by
omission.

| route | note |
|---|---|
| `/api/entity` | The generic path most taps take. Replaces its older `requestContext()` logging, which fires only when `isAirconRelated()` is true and omits caller IP from its event entirely. |
| `/api/zone` | |
| `/api/lights/*`, `/api/all-lights/*`, `/api/outside-light/*` | Nine routes, one edit — they share `lib/api/light-shortcut-endpoint.ts`. |
| `/api/climate-control` | Already attributed; gains the person. |
| `/api/bedroom-heater` | Already attributed; gains the person. |
| `/api/aircon/timer`, `/api/panel-heater/timer` | Previously attributed nowhere at all. |
| `/api/modes` | |
| `/api/desktop/sleep`, `/api/desktop/wake` | The two that are user actions. |

Everything above funnels through one `callService()` in `lib/ha/client.ts`, so
this inventory is complete rather than best-effort. A new control route that does
not call `attributeControl` is a gap, and the route list here is where that gets
noticed.

**`/api/doorbell/sequence` is deliberately excluded**, having been listed in the
plan. It is an inbound webhook from the doorbell device, bearer-authorised, not
a control anybody touches. Attributing it to whoever the witness last saw at the
panel would manufacture a claim that somebody pressed something they did not —
the exact failure this feature exists to avoid. The same reasoning applies to any
future device-originated callback: attribution is for things a person did.

---

# Surfacing

## The dashboard panel

`app/components/config/KioskActivityConfig.tsx`, inside a `ConfigAccordion`
section in `ConfigWorkspace`.

Recent kiosk **sessions**, each one a person, a time range, and the list of what
was done — the same grouping the digest sends, so the panel and the Discord
message can never disagree about what happened. "Unidentified" where there is no
match, never a guess. The observation age is shown so a weak attribution reads as
weak. The open session shows as still open rather than as a very short one.

Reads `GET /api/kiosk/witness/activity`, added to `@admin_any` in **both** vhost
copies of the matcher — `config_gate_authed` and `config_gate_denied` — matched
by **path and never by method**. The Caddyfile already carries the note about why
this matters: `@admin_writes` filters on `PUT POST PATCH DELETE`, so a GET
matches neither matcher and falls through completely ungated, which during the
face build briefly left the subject thumbnail readable by anyone on the LAN. A
list of who was in the room is the same class of thing.

## The Discord digest

`nova-module-discord` subscribes to `kiosk.session.digest` and sends one message
per session: who it was, when, and what they did. Ten seconds of quiet is the
trigger, so a visit is one message rather than a stream. A continuation inside
the identity window edits that message instead of posting again.

Notification only. **No buttons.** This is a log, not a control, and the
revocation-only asymmetry `face-auth.md` establishes for the Discord veto is not
weakened by hanging an action off a different message in the same channel.

Configurable whether every session is sent or only sessions that are
unidentified or not the owner. Default: every session — the point is knowing what
happened at the panel, and a filter that only reports strangers is a filter that
looks broken on a quiet week.

Account mapping reuses the `accounts` array the face veto added to the module's
`configSchema`: `discordHandle`, `discordUserId`, `authentikUsername`. A face
subject with no mapped account gets no digest, and that is recorded rather than
silent.

---

# Configuration

Daemon, `/etc/nova-kiosk-witness.env` on Nocturnium:

| name | default | meaning |
|---|---|---|
| `NOVA_FACE_KEY` | — | Required. The oracle's shared key. No default, no unauthenticated mode. |
| `NOVA_WITNESS_KEY` | — | Required. The witness's own key for the dashboard routes. |
| `NOVA_FACE_URL` | `https://nova.tuatara-dory.ts.net/face` | |
| `NOVA_DASHBOARD_URL` | `http://127.0.0.1` | The kiosk's own local dashboard route. |
| `WITNESS_CAMERAS` | `LifeCam=0,USB2.0 HD=90` | `name=degrees` pairs, most preferred first. Matched against the kernel card name, not a device path. |
| `WITNESS_FORBIDDEN_DEVICES` | `/dev/video4,/dev/video5` | Refuse to start if resolution lands here. |
| `WITNESS_FORBIDDEN_NAMES` | `macrosilicon,2109` | Same refusal, by name — the path alone stops meaning anything once node numbers move. |
| `WITNESS_INPUT_FORMAT` | `mjpeg` | v4l2's default (YUYV) caps at 10 fps on both cameras at 720p; MJPG does 30. |
| `WITNESS_FRAMERATE` | `30` | |
| `WITNESS_VIDEO_SIZE` | `1280x720` | |
| `WITNESS_CLIP_SECONDS` | `1.2` | |
| `WITNESS_IDENTIFY_RETRIES` | `2` | Per session, after a failed opening capture. |
| `WITNESS_RETRY_MIN_SECONDS` | `5` | |
| `WITNESS_POLL_HZ` | `1` | |

Dashboard, the container environment:

| name | default |
|---|---|
| `KIOSK_IDENTITY_TTL_SECONDS` | `30` |
| `KIOSK_DIGEST_QUIET_SECONDS` | `10` |
| `KIOSK_ACTIVITY_RING` | `500` |
| `NOVA_WITNESS_KEY` | — (required for the witness routes to accept anything) |

Missing `NOVA_FACE_KEY` or `NOVA_WITNESS_KEY` means the daemon refuses to boot,
the same discipline the face service uses. Missing `NOVA_WITNESS_KEY` on the
dashboard means the witness routes reject everything, which degrades to today's
behaviour — IP-only attribution — rather than to an open endpoint.

# Deployment

`ops/nocturnium-kiosk-witness.py` and its unit install to Nocturnium alongside
the existing camera proxy. Nothing in the dashboard container needs the camera.

Nothing under `ops/` or `lib/` may carry a key, a host address or a household
name; this repo pushes to public GitHub. Nocturnium's addresses live in
`nova-household`, host addresses in this spec are covered by the existing
`specs/` scrub exception, and subject names are data in SQLite — never fixtures,
never test constants.

# Done means

- Touching the kiosk opens a session, captures exactly one clip, deletes it, and
  records one observation.
- A control changed during that session carries the person in its dashboard
  event, visible in Grafana alongside `callerIp`.
- **The optimisation holds**: touch, change three things over ~25 s, stop.
  Exactly one `/identify` call for the whole session; one digest ~10 s after the
  last touch listing all three actions; one row in the config panel, not three.
- **The continuation holds**: a touch 15 s after that digest causes no second
  capture and edits the existing Discord message rather than posting a new one.
  A touch after the identity TTL opens a new session with a fresh capture.
- An unenrolled person is recorded as unidentified, not as a nearest neighbour.
- A session with no actions produces no digest.
- The daemon refuses to start pointed at `/dev/video4`, and refuses to start
  without a key.
- The face service being down, or Nocturnium being off, changes nothing about
  the kiosk's ability to control the house.
- Unit tests for the session state machine: the identity TTL extends on touch and
  not on wall time; the digest flushes once; a continuation appends rather than
  opening a session; an actionless session flushes nothing; a caller that is not
  Nocturnium never joins to a session.
- `npm run test:unit` passes, `lib/no-household-data.test.ts` included.
