# Outside, Weather, and Map

Outside controls:

- The outside panel controls the first outside light/illumination device in the
  outside zone.
- It renders `CameraPanel` for camera ID `outside`, followed by weather and the
  map panel.

Outside camera and DVR:

- The production source is a MacroSilicon MS210x / EasierCAP S-Video capture
  adapter (`534d:0021`, serial `20200909`) connected to Nova.
- The recorder opens the stable container path
  `/host-dev/v4l/by-id/usb-MACROSILICON_AV_TO_USB2.0_20200909-video-index0`
  as V4L2 MJPEG at 720x480 and 25 fps. The device does not expose a V4L2
  PAL/NTSC standard control, so production sets the standard option to `none`.
- One long-lived ffmpeg process captures the source and writes two-second H.264
  MPEG-TS segments plus `index.m3u8` under `data/camera/outside/`.
- The playlist is a rolling two-hour window with program-date-time tags. ffmpeg
  deletes rolled-off segments, and the recorder also sweeps orphaned files and
  refuses to serve expired segments.
- The camera panel supports live playback, play/pause, scrubbing through the
  available DVR window, and a Live button that returns to the live edge.
- The captured 720x480 frame is displayed in a 16:9 stage. The DVR output is
  anamorphic/widescreen, so the video uses `object-fit: fill` to map the complete
  frame into 16:9, correcting its apparent vertical stretch without cropping or
  changing the recorded pixels.
- Browser playback prefers native HLS where supported (notably Safari/WebKit)
  and uses hls.js elsewhere. A configured remote video host is fetched through
  Nova's same-origin `/api/camera-proxy/...` route so HTTPS clients never load
  an HTTP camera stream as mixed content.
- Recorder startup is idempotent, automatically retries failed ffmpeg processes
  with bounded backoff, and pauses during dashboard self-update builds.
- When `NOVA_CAMERA_OUTSIDE_DEVICE` is unset or its path is absent, the recorder
  uses the retained ffmpeg `testsrc2` signal and live clock generator. This
  fallback must remain installed even while physical capture is active.
- Static demo mode has no server recorder; it renders the equivalent animated
  clock placeholder on a canvas and leaves DVR scrubbing inactive.
- The panel displays source/connection state and an offline overlay when no
  playable recorder output is available.
- Camera hardware image controls are host-side V4L2 controls, not dashboard
  preferences. `v4l2-utils` is installed on Nova. The capture stick exposes
  brightness `0..255` (default 26), contrast `0..255` (default 140), saturation
  `0..255` (default 150), hue `-128..127` (default 0), and backlight
  compensation `0..255` (default 0).
- Manual brightness changes use the stable host path, for example:

```bash
v4l2-ctl -d /dev/v4l/by-id/usb-MACROSILICON_AV_TO_USB2.0_20200909-video-index0 --set-ctrl=brightness=10
```

- Reset brightness with `--set-ctrl=brightness=26`. Hardware controls may
  return to device defaults after a reboot or USB reconnect.
- `nova-ha-dashboard.service` resets the adapter to its advertised hardware
  defaults before every launch: brightness 26, contrast 140, saturation 150,
  hue 0, and backlight compensation 0. The command is optional so an unplugged
  adapter does not prevent the synthetic fallback from starting.
- Stable user tuning is applied downstream in ffmpeg rather than through the
  adapter's volatile/automatic image processing. The physical feed supports
  `NOVA_CAMERA_OUTSIDE_BRIGHTNESS` (`-1..1`, neutral 0),
  `NOVA_CAMERA_OUTSIDE_CONTRAST` (`0..2`, neutral 1), and
  `NOVA_CAMERA_OUTSIDE_SHARPNESS` (`0..5`, neutral 0). Brightness and contrast
  use ffmpeg `eq`; sharpness uses the luma channel of `unsharp`.
- These software filters apply only to the device source. The synthetic signal
  test retains its own drawbox/drawtext filter chain unchanged.
- `/config` includes a Camera accordion with a compact live HLS preview and
  brightness, contrast, and sharpness sliders in the shared rectangular slider
  style. Apply persists the values under `dashboard.camera.outside.processing`
  and restarts only the outside recorder; the preview reconnects automatically
  while the restarted recorder warms up (the playlist 404s for a second or two),
  and the dashboard and Home Assistant remain running.
- A Reset button restores the panel defaults: brightness -0.12, contrast 1.1,
  and sharpness 0.6.
- Iridium runs the recorder-independent `nova-camera-events.service`, consuming
  the configured remote HLS feed and exposing its private API on localhost
  port 8098. The dashboard proxies event metadata/media through same-origin
  `/api/camera/<id>/events` routes.
- Daytime YOLO detection records people, cats, dogs and other non-bird animals;
  vehicles supply proximity context rather than generating ordinary traffic
  events. Normalized activity, vehicle and exclusion polygons are edited
  visually in Camera configuration; existing vertices are draggable. The editor
  defaults to the last persisted daylight frame so zones remain editable after
  dark, with an explicit switch back to the live frame. That calibration cache
  is permanent runtime data: event retention does not remove it and camera
  processing never replaces it automatically.
- Event media is a representative JPEG and an MP4 remux with 10-second pre-roll
  and 20-second post-roll. Unstarred retention is 14 days or 50 GB, with a
  20-GB host reserve; starring excludes an event from automatic retention.
- Event review supports a selection mode, selecting every event visible under
  the current filter, and one confirmed bulk deletion of selected clips.
- Moondream2 performs queued, best-effort observable-behavior descriptions.
  Important/urgent Home Assistant alerts wait for that detailed pass. Machine
  labels never claim human identity or intent and uncertain cat/ute reference
  matches remain explicitly tentative.

Face recognition and face-released passkey (`specs/face-auth.md`):

- A separate LAN service on port 8099 answers "who is standing here" from a
  short video clip: RetinaFace detection, ArcFace embeddings, a landmark-residual
  liveness test and a texture anti-spoof model. It never opens a capture device
  itself — it is a stateless verifier of clips submitted to it, so the kiosk, a
  satellite or a script are all clients on equal terms.
- Every endpoint requires the `X-Nova-Face-Key` header, `/healthz` included; an
  unauthenticated health endpoint would advertise how many people are enrolled.
  The service refuses to boot without the key and has no unauthenticated mode.
- Caddy exposes it at `/face/*` on the HTTPS vhost only, gated on the same
  header. The plain-HTTP vhost excludes it: the key would otherwise cross a
  WiFi-only LAN in cleartext.
- Browsers never hold that key. The dashboard proxies at same-origin
  `/api/face/*` (`app/api/face/**`) and injects the header server-side in
  `lib/face-auth-client.ts`. A key shipped to a browser is a key on every device
  that loads the dashboard. Multipart clips stream through the proxy rather than
  being parsed and re-encoded.
- The ceremony, in brief: the browser starts the authentik flow and receives a
  WebAuthn challenge; it posts that challenge plus a fresh nonce and a 1-second
  clip to `/api/face/assert`; the service checks network binding, the nonce,
  the armed state and the lockout counters, then liveness and identity, unseals
  an ES256 credential held on the trusted host, signs, and zeroes the key; the
  browser submits the assertion and authentik sets its own session cookie. The
  passkey is the credential. **Face is only the release condition on its use and
  is never itself a bearer credential** — nothing downstream accepts "the face
  service said so" as proof.
- Behavioural contract, and the part that must not be softened by a later
  convenience change: **ambiguity and crowds are refusals, not guesses.** More
  than one face in frame is `multiple_faces`; there is no "pick the biggest"
  rule, because one of the others may be the person being walked past the camera
  under duress. A match inside the runner-up margin is `ambiguous`. An unknown
  face returns no subject rather than a nearest neighbour. A subject with no
  mapped Discord veto channel gets no signature at all — an unvetoable release
  is not a release.
- Refusals name a stable machine-readable `reason`. The UI renders those strings
  and deliberately shows the same text for `liveness_rigid` and `antispoof`, and
  one text for all three lockout reasons: which signal caught an attempt is
  calibration data in the service's `attempts` table, not a tuning aid to hand
  back to whoever was caught.
- Enrolment lives in `/config` under User Data, beside the voice speaker
  profiles — household people and the identities recognised against them.
  Consenting household members only; there is no path here to identifying anyone
  who has not enrolled. Five clips at ordered angles, each passing the same
  liveness gate as authentication, because an enrolment path that skips liveness
  is a path to enrolling a photograph. Progress comes from the server's
  `clipsSoFar`/`remaining`, so a rejected clip does not advance the count. Raw
  frames are not retained — embeddings plus one thumbnail per subject.
- Enrolment requires an authentik session and `getUserMedia` requires a secure
  context, and only the HTTPS tailnet origin offers both. The UI detects
  `window.isSecureContext` and explains that, rather than failing opaquely. The
  camera picker prefers a device whose label does not look like a capture card,
  so enrolment is not silently bound to a grabber carrying an outdoor camera; it
  still lists every device, and it reads labels rather than fixed device paths,
  so there is nothing host-specific in the dashboard.
- Media tracks are released on unmount, on section collapse and after the final
  clip.
- Later, not now: `camera-events` `owner_identity()` (`camera-events/service.py`
  around line 806) currently suppresses owner alerts by comparing whole-body
  DINOv2 embeddings, and could instead call the face service's `/identify` for a
  far better signal. `/identify` is deliberately liveness-free and token-free so
  a background analysis pass can use it, and is never sufficient to let anybody
  in. Design for that swap; do not build it — camera-events would need the key in
  its own env file and a fallback for when the face service is down.

Weather panel:

- Displays current condition, feels-like, current temperature, min/max, rain
  chance, UV, wind, and humidity when present.

Map panel:

- Client-only MapLibre GL component.
- Default center is Auckland and can be configured.
- Uses an OpenFreeMap vector source.
- Uses RainViewer radar through `/api/radar`.
- Uses Esri satellite imagery through `/api/satellite`.
- Displays background, landuse, satellite, water, radar, roads, buildings,
  street labels, place labels, and a home marker.
- 3D building extrusions vary color and opacity by render height and zoom.
- Theme is driven by CSS variables controlled from `/config`.
- Navigation controls are present.
- Scroll wheel uses custom eased zoom around cursor.
- W/A/S/D panning is supported while the mouse is held.
- Right-drag rotation is supported.
- Context menu is disabled.
- Radar source refreshes every 60 seconds and changes tile bucket every
  5 minutes.
- `nova-accent-change` reapplies map theme.

Radar tile proxy:

- Route: `/api/radar/[z]/[x]/[y]`
- Fetches RainViewer manifest with fallback host support.
- Caches manifest for roughly 4 minutes.
- Validates tile coordinates.
- Maximum radar zoom is 7.
- Returns transparent PNG for invalid or missing data.
- Can recolor radar PNGs using `sharp`.
- Cache-control permits short public caching with stale revalidation.

Satellite tile proxy:

- Route: `/api/satellite/[z]/[x]/[y]`
- Proxies Esri satellite tiles.
- Applies tint/brightness processing with `sharp`.
- Returns a black fallback tile on failure.
- Supports zoom up to 19.
- Uses long cache-control with stale revalidation.
