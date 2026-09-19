# Kiosk display rotation from the built-in camera

Produced in session 2026-09-16 (no plan-mode plan file; interview answers below
were taken with AskUserQuestion in the same session).

The wall-panel kiosk (Nocturnium, KDE Plasma on Wayland, panel output `eDP-1`)
has no accelerometer — confirmed 2026-09-20: it is an ASUS Zen AiO M5401WUA
desktop with no `/sys/bus/iio` at all, which is why KDE reports "Auto Rotate
Policy: incapable". The camera is the only orientation sensor there is. Its built-in webcam (`USB2.0 HD UVC WebCam: USB2.0 HD`)
is fixed to the panel, so the room's apparent rotation in that camera is the
panel's rotation in the world. A daemon on the kiosk reads it and rotates the
desktop so the display is upright.

## Requirements (from Adeline, 2026-09-15)

- Use the **built-in** camera only. Never the LifeCam: it floats and always
  sits at the physical top of the screen, so it carries no orientation.
- Poll **every 60 s**, and also **whenever the kiosk browser enters or reloads
  the dashboard front page (`/`) or the config page (`/config…`)**, including
  client-side navigation between them.
- Change the **OS desktop rotation** (`kscreen-doctor output.<name>.rotation.*`).
- **One frame is retained** (2026-09-20): the last frame that produced a
  confirmed rotation, at `/var/lib/nova-kiosk-orient/last.jpg`, 640x480,
  owner-only, overwritten each time so no older frame survives. It is never
  logged, never shown, and never served. Every other frame is decoded in
  memory and discarded. Capture is local V4L2, never through the browser.
  The retained frame leaves the machine only as a base64 payload to DeepSeek,
  and only when an orientation change has already been detected.
- A reading **within 15° of the retained frame** means nothing moved: no
  rotation, no API call.
- A reading **more than 15° from the retained frame** means the panel has been
  turned. Settle first (re-read every 1 s for up to 5 s, two consecutive
  readings agreeing within 15°), then **ask DeepSeek which way the settled
  frame is facing** and apply its answer.
- **Hourly, regardless of the local reading** (Adeline, 2026-09-20): send a
  frame to DeepSeek and apply the orientation it reports. The local match is a
  cheap change detector; this is the standing authority that corrects it when
  it has quietly drifted or gone blind. One call an hour is the floor, not an
  extra — a change-triggered call resets the hour.
- **Low-confidence readings** (dark room, camera busy, too few matches) change
  nothing. Logged, then wait for the next trigger. No burst.
- The existing fixed built-in camera rotation (`WITNESS_CAMERAS` `USB2.0 HD=90`,
  `dashboard.kiosk.cameras` preview rule) now **follows the detected
  orientation** and applies only to authentication/attribution captures and
  the face preview.

## Method: local change detection, DeepSeek for absolute orientation

The 2026-09-16 design matched every frame against one pinned upright reference
and trusted the resulting angle outright. It failed in service overnight
2026-09-19/20: in a dark room the matcher returned *confident* readings at
barely-over-threshold inlier counts (25-36), and a spurious `0.0°` at 06:07
rotated the panel out of `right` into `normal`, leaving it wrong all morning.
Two readings either side of it said 268° and 275°.

So the local match no longer decides anything absolute. It answers one
question — *has the view moved since the frame we last acted on?* — and a
vision model answers the one that matters, *which way is this frame facing?*

### The retained frame

`/var/lib/nova-kiosk-orient/last.jpg` is the frame that produced the last
confirmed rotation, beside `last.npz` (its ORB keypoints and descriptors) and
the cardinal that was applied to it, in `state.json`. Writing a new one
replaces both files atomically; **no older frame is kept**. It is a *rolling*
reference: each confirmed rotation replaces it, so the 15° test always
measures change since the last moment orientation was known to be right.
Drift cannot accumulate, because DeepSeek re-establishes absolute truth every
time the frame is replaced.

### Per reading

1. Open `/dev/videoN` resolved by card-name substring `USB2.0 HD` (lowest
   node; never the IR node, never forbidden `macrosilicon`/`2109`). MJPG,
   640x480. Discard the first 8 frames (auto-exposure), keep the 9th, release.
2. Grayscale, CLAHE, ORB (1500 features).
3. Hamming kNN match against `last.npz`, Lowe ratio 0.75,
   `estimateAffinePartial2D` RANSAC (reprojection 6 px). `delta =
   atan2(M[1,0], M[0,0])` is how far the view has turned **since the retained
   frame**, not since upright.
4. Confident when inliers ≥ 25 and inliers/good ≥ 0.25.
5. `|delta| ≤ 15°` and no hourly check due: nothing happened. Return.
6. `|delta| > 15°`, or the match was not confident, or the hour is up: settle,
   then ask DeepSeek.

### Settling

Re-read every 1 s for up to 5 s until two consecutive readings agree within
15°. This keeps a hand mid-turn from spending an API call on a blurred frame.
If it never settles, the last reading is used anyway — the model is better
placed to judge a marginal frame than the matcher is.

### Asking DeepSeek

`POST https://api.deepseek.com/v1/chat/completions`, model
`deepseek-v4-flash-vision-exp` — an alias for the single `deepseek-flash`
backend, which does read images.

**It is never shown a sideways photo.** Measured 2026-09-20 against this
model: asked *which edge is nearest the ceiling*, it answered upright and
upside-down frames correctly every time, but on a frame turned 90 or 270 it
reasoned in circles and hit the token ceiling without ever answering — and
90/270 is exactly this panel's case. A binary *is this upright?* on a sideways
frame failed the same way.

So the question is inverted. Each candidate cardinal is **un-done first**, and
the model is asked only to confirm an already-upright picture:

> Is this photo the right way up, with the ceiling at the top and the floor at
> the bottom? Answer with exactly one word: yes or no.

The first candidate confirmed `yes` is the answer. Candidates are tried in the
order: the rotation currently applied, then what the local match predicts,
then the rest — so the usual case costs one call, not four.

`max_tokens` is 900. This is a reasoning model: it spends completion tokens on
`reasoning_content` before writing a word of `content`, and a 16-token budget
returned an empty answer with `finish_reason: length` every single time.

**An empty or unreadable reply is a retry signal, never a "no."** Roughly one
call in three returns empty content for a question the next call answers.
Counting a flaky blank as a rejection walks straight past the correct
rotation — it scored 2/4 before this was fixed and 4/4 after. An explicit
verdict, either way, is final and costs no further calls. Three attempts,
2 s apart.

**On failure, fall back to the local angle** (Adeline, 2026-09-20):
`cardinal = round((retained cardinal + delta) / 90)`, applied only when the
match was confident. This is the path that produced the overnight failure, so
it is the fallback and not the primary; when the match was not confident
either, nothing is applied. A fallback rotation deliberately does **not**
replace the retained frame, so a guess cannot become the next baseline —
which is why `state.json` tracks `retainedCardinal` separately from the
rotation currently applied.

### The privacy gate

**No frame containing a person is ever sent** (Adeline, 2026-09-20). Before
any request, the frame is checked locally by two detectors on all four
rotations, because the camera itself may be mounted sideways:

- **YuNet** (`yunet.onnx`, deployed to `/var/lib/nova-kiosk-orient/`), score
  threshold 0.6.
- **HOG pedestrians**, weight threshold 0.6. The floor matters: HOG reports
  every candidate it scores above zero, and on furniture that is a steady
  trickle of nonsense. Measured 2026-09-20, an empty living room peaked at
  0.43 while a person really in this camera's frame scored 0.76 and their face
  0.69. Ungated, the detector fired on every frame of an empty room — and a
  gate that never clears silently disables the vision model, leaving the
  system on the ORB fallback that failed in the first place.

The gate is biased toward suppressing: no detector available, or a detector
that errors, counts as occupied. A suppressed frame costs one skipped call,
retried on the next 60 s tick.

Face orientation was evaluated as a *local* substitute for DeepSeek and
**rejected**: on a real frame from this camera YuNet scored the wrong rotation
higher than the right one (0.69 at c=0 against the true 0.54 at c=270).
Hough line analysis was rejected too — the room yields ~11 lines, far too few
for a structural tilt, and a line family only gives tilt mod 90 anyway.

### Mapping

| room in frame (c) | panel physically | kscreen rotation | camera correction (CW deg) |
|---|---|---|---|
| 0 | landscape | `normal` (1) | 0 |
| 90 CW | turned anticlockwise | `left` (2) | 270 |
| 180 | upside down | `inverted` (4) | 180 |
| 270 CW | turned clockwise | `right` (8) | 90 |

Camera correction = `(360 − c) % 360`: the clockwise turn that stands the
built-in camera's raw picture upright. Verified live 2026-09-20: with the
panel physically turned clockwise into portrait, the raw frame shows
world-up at the frame's left edge, giving c = 270 → `right`.

## Triggers

- 60 s timer inside the daemon (the local change detector).
- 3600 s since the last DeepSeek answer (the standing authority). Runs on the
  next 60 s tick after the hour is up, and any change-triggered call resets it.
- CDP on `127.0.0.1:9223` (the kiosk Brave). Attach to the page target whose
  URL starts with `NOVA_BACKEND_URL`; `Page.frameNavigated` (main frame) and
  `Page.navigatedWithinDocument`. Trigger when the new path is `/` or starts
  with `/config`. Reconnect every 5 s if Brave restarts. CDP is only a
  notification channel; nothing is captured through the browser.
- Triggers arriving during a reading coalesce into one follow-up reading.

## Shared state

The daemon writes `/var/lib/nova-kiosk-orient/state.json` (owned by the login
user, readable by the witness):

```json
{"rotation": "left", "cameraCorrection": 270, "camera": "USB2.0 HD", "updatedAt": 1789000000}
```

Only written from a confident, settled reading.

- **Witness** (`nocturnium-kiosk-witness.py`): for a camera whose name matches
  the state's `camera`, use `cameraCorrection` in place of the
  `WITNESS_CAMERAS` degrees. No state file → the env value. Default for
  `USB2.0 HD` becomes `0` (upright in landscape).
- **Face preview** (browser): the daemon writes
  `localStorage["nova.kiosk.cameraRotations"] = [{"match":"USB2.0 HD","degrees":N}]`
  into the kiosk page over CDP after each change and on each page load, and
  dispatches `nova:kiosk-camera-rotation`. `FacePreview` rules from that key
  take precedence over `dashboard.kiosk.cameras`. Other devices never have the
  key, so they are unaffected. `nova-household` config rule for `USB2.0 HD`
  becomes `0`.

## Deployment

- `ops/kiosk/nova-kiosk-orient.py`, user unit `nova-kiosk-orient.service`
  (needs the Wayland session for `kscreen-doctor` and seat ACLs for the camera).
  The script is the entry point; its body is the sibling package
  `ops/kiosk/nova_kiosk_orient/`, which imports because Python puts the
  script's own directory on `sys.path`.
- `deploy-kiosk-orient.ps1` at repo root: installs `python3-opencv`, the
  script and its package (and the witness script and its package), the unit,
  `/var/lib/nova-kiosk-orient` owned by the login user; enables and restarts.
- `deploy-kiosk-orient.ps1` also fetches and checksums `yunet.onnx` (cached in
  the git-ignored `ops/kiosk/models/`), and writes `DEEPSEEK_API_KEY` from the
  deploying machine's environment to `~/.config/nova-kiosk/orient.env` (0600),
  which the unit reads via `EnvironmentFile`. The key is copied as a file, not
  passed on a command line, so it never reaches the remote process table.
- `nova-kiosk-orient.py seed` establishes the retained frame now. It needs an
  empty room: seeding asks DeepSeek, and the gate blocks a frame with a person
  in it. The daemon otherwise seeds itself on the first tick that finds the
  room empty.
- `nova-kiosk-orient.py check` runs one full pass and prints every stage —
  the reading, the gate's verdict, DeepSeek's answer and the local fallback —
  without applying anything.

## Done means

- Service active on Nocturnium; log shows readings at 60 s and on a dashboard
  reload of `/` and `/config`.
- Orientation is correct at all four rotations. Verified 2026-09-20 against a
  known indoor photo turned to each cardinal: **4/4**.
- The gate clears an empty room and fires on an occupied one. Verified
  2026-09-20 both ways.
- Exactly one image file exists under `/var/lib/nova-kiosk-orient` (`last.jpg`,
  0600) and no other frame is written anywhere.
- Witness and preview follow the state; dashboard tests pass.
