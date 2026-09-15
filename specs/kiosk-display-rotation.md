# Kiosk display rotation from the built-in camera

Produced in session 2026-09-16 (no plan-mode plan file; interview answers below
were taken with AskUserQuestion in the same session).

The wall-panel kiosk (Nocturnium, KDE Plasma on Wayland, panel output `eDP-1`)
has no accelerometer. Its built-in webcam (`USB2.0 HD UVC WebCam: USB2.0 HD`)
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
- **Frames are never retained, written to disk, logged or shown**, and never
  captured through the web/browser. Capture is local V4L2, decoded in memory,
  discarded after analysis.
- If a reading is **more than 15° from a cardinal angle** (mid-rotation, or far
  from square): re-read **every 1 s for the next 5 s**. The first reading within
  15° is applied. If none settles, do nothing and return to normal polling.
- Readings **within 15°** of a cardinal are applied (when different from the
  current rotation).
- **Low-confidence readings** (dark room, camera busy, too few matches) change
  nothing. Logged, then wait for the next trigger. No burst.
- The existing fixed built-in camera rotation (`WITNESS_CAMERAS` `USB2.0 HD=90`,
  `dashboard.kiosk.cameras` preview rule) now **follows the detected
  orientation** and applies only to authentication/attribution captures and
  the face preview.

## Method: reference match

One upright reference taken 2026-09-16 with the kiosk in default landscape
and the camera the right way up (Adeline's statement). **Only ORB keypoint
coordinates and descriptors are stored** (`reference.npz`), never pixels.

Per reading:

1. Open `/dev/videoN` resolved by card-name substring `USB2.0 HD` (lowest
   node; never the IR node, never forbidden `macrosilicon`/`2109`). MJPG,
   640x480. Discard the first 8 frames (auto-exposure), keep the 9th, release.
2. Grayscale, CLAHE, ORB (1500 features).
3. Hamming kNN match against the reference, Lowe ratio 0.75.
4. `estimateAffinePartial2D` RANSAC (reprojection 6 px) from reference points
   to current points.
5. Confident when inliers ≥ 25 and inliers/good ≥ 0.25. Otherwise
   low-confidence.
6. `φ = atan2(M[1,0], M[0,0])` in image coordinates (y down), so positive φ is
   the room turned **clockwise** in the frame. Nearest cardinal `c`, deviation
   `|φ − c|`.

### Mapping

| room in frame (c) | panel physically | kscreen rotation | camera correction (CW deg) |
|---|---|---|---|
| 0 | landscape | `normal` (1) | 0 |
| 90 CW | turned anticlockwise | `left` (2) | 270 |
| 180 | upside down | `inverted` (4) | 180 |
| 270 CW | turned clockwise | `right` (8) | 90 |

Camera correction = `(360 − c) % 360`: the clockwise turn that stands the
built-in camera's raw picture upright. The panel ⇄ kscreen column is derived,
not yet physically exercised; the math column is verified by rotating a live
frame in memory and checking the reading.

## Triggers

- 60 s timer inside the daemon.
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
- `deploy-kiosk-orient.ps1` at repo root: installs `python3-opencv`, the
  script, the unit, `/var/lib/nova-kiosk-orient` owned by the login user;
  enables and restarts.
- `nova-kiosk-orient.py reference` captures the reference. Refuses to
  overwrite without `--force`.

## Done means

- Service active on Nocturnium; log shows readings at 60 s and on a dashboard
  reload of `/` and `/config`.
- Reference present; a live reading in landscape reads within 15° of 0 and
  confident; in-memory 90° rotation of a live frame reads ≈90.
- No image file exists anywhere the daemon touches.
- Witness and preview follow the state; dashboard tests pass.
