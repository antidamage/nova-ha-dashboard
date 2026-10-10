<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Display rotation: the rotate button

Adeline, 2026-10-11. No plan-mode plan file: the request was specific enough to
write straight into this spec (the interview was skipped on purpose; every
number below is from her message or marked as a decision).

This replaces the camera-driven auto-rotation (built 2026-09-16, rebuilt
2026-09-20, removed 2026-10-11 because it "was not working very well"). That
mechanism read the built-in webcam, matched ORB features, and asked DeepSeek
which way was up. None of it remains: no camera capture for orientation, no
retained frame, no DeepSeek call, no people gate, no hourly check. Its history
is in git.

## The feature

A round-arrow **rotate button**. One tap rotates the display **clockwise by 90
degrees**: the picture turns the way a clock hand does, so landscape becomes
portrait with the old top edge now on the right, and four taps are a full turn.

It exists for a wall panel that has no orientation sensor (the Nocturnium
kiosk, an ASUS Zen AiO with no `/sys/bus/iio`) and gets turned by hand.

### Where it appears

- **Only when "Allow display rotation" is on** for this machine, and only when
  this machine does not sense its own orientation (below).
- **Landscape** (`aspect-ratio > 1`): bottom **right** corner.
  **Portrait**: bottom **left** corner. The button sits at the viewport corner,
  12px in on landscape and 16px in on portrait, plus the safe-area inset.
- It is one of the header buttons (`.dashboard-config-link`), so it **fades out
  on scroll exactly as they do**: opacity `1 - --nova-header-fade`, and no
  pointer input once `nova-header-controls-disabled` is set (fade at least half
  in). Nothing about that behaviour is new code.
- Icon only (`RotateCw`), 44px square like its neighbours. `aria-label`
  "Rotate display clockwise".

### The setting

- Name: **Allow display rotation**. It is a `SwitchRow` in the config page's
  **This Device** section, beside Auto Fullscreen.
- **Per machine, not per theme**: `localStorage["nova.dashboard.displayRotation.v1"]`
  (`"true"` / `"false"`), the same model as Auto Fullscreen and the reminder
  banner (`autoFullscreenSetting.ts`). Never in a theme, never in the shared
  host config, never travelling between devices. Absent means **off**.
  Code: `app/components/dashboard/displayRotationSetting.ts`.
- **On for the kiosk.** Set once on Nocturnium's Brave profile; it persists
  there.

### Devices that rotate themselves

A device that senses its own orientation must not be offered the option: the OS
already rotates the page, and a second rotation fights it.

- The switch is **disabled** and shows the reason ("This device rotates itself,
  so manual rotation is not offered"). A stored `"true"` on such a device is
  ignored: the button does not show.
- A device counts as self-rotating when **any** of these holds
  (`app/components/dashboard/autoRotationSensing.ts`):
  1. `navigator.userAgentData.mobile` is true;
  2. the user agent names iPhone, iPad, iPod or Android;
  3. iPadOS reporting as a Mac: `Macintosh` with `maxTouchPoints > 1`;
  4. a **sensor probe**: within 1.5 s of mount a `deviceorientation` event
     arrives with a non-null `beta` or `gamma` (a real accelerometer; desktop
     browsers fire it with nulls or not at all).
- **The OS auto-rotate flag cannot be read.** No web API exposes the Android or
  iOS rotation lock, so the decision does not look at it: a phone with rotation
  locked still senses orientation and is treated as self-rotating. Checked
  2026-10-11; if a browser ships such a flag, add it to the list above.
- Rules 1-3 resolve synchronously; rule 4 can only turn the answer from "no" to
  "yes" later. The button therefore never flashes on for a self-rotating device
  that rules 1-3 catch, and a sensor-only device (a tablet with a desktop user
  agent) hides within 1.5 s.

## How the rotation happens

The layouts are chosen by viewport media queries (`aspect-ratio`, see
`specs/landscape-layout.md` and `specs/portrait-layout.md`), so rotating the page
with CSS would leave the wrong layout showing. The **operating system** rotates
the output and the browser's viewport follows, which switches the layout for
free.

A page cannot do that itself, so the kiosk runs a small user service,
`ops/kiosk/nova-kiosk-rotate.py` (unit `nova-kiosk-rotate.service`), on the
machine that owns the display:

1. It attaches over CDP (`127.0.0.1:9223`, the kiosk Brave) to the page whose URL
   starts with `NOVA_BACKEND_URL` (`~/.config/nova-kiosk/backend.env`),
   reconnecting every 5 s if Brave restarts.
2. It registers a CDP **binding**, `Runtime.addBinding("novaKioskRotate")`.
   That puts `window.novaKioskRotate(payload)` into every document of that
   page, including after navigation. A machine without the service has no such
   function, and the button then does nothing but log a warning.
3. A call to it advances the output **one step clockwise** with
   `kscreen-doctor output.<name>.rotation.<value>`.
4. Calls arriving within 1.5 s of a rotation are ignored, so a double tap is one
   step.

Rotation values are KDE's, and the cycle that turns the picture clockwise is

`normal -> left -> inverted -> right -> normal`

(a clockwise picture turn is the output's `left`; `right` is where a panel
physically turned clockwise sits, and it turns the picture the other way).

### Shared state the old daemon also kept

The face witness and the face preview rotate the built-in camera's raw picture
to match the panel, so the service still records the rotation it applied and
pushes it where those two read it:

- `/var/lib/nova-kiosk-rotate/state.json`:
  `{"rotation": "left", "cameraCorrection": 270, "camera": "USB2.0 HD", "updatedAt": 1789000000}`.
  Camera correction is `(360 - c) % 360` where `c` is 0, 90, 180, 270 for
  normal, left, inverted, right. `ops/nocturnium_kiosk_witness/config.py`
  reads it (`WITNESS_ORIENT_STATE`).
- `localStorage["nova.kiosk.cameraRotations"] = [{"match":"USB2.0 HD","degrees":N}]`
  in the kiosk page over CDP, on connect, after each rotation and on each page
  load, then `nova:kiosk-camera-rotation` is dispatched. `FacePreview` reads it.
- The service writes this state for the rotation it **applies**. It does not
  read the camera, and a rotation made outside the button (KDE settings) is not
  noticed until the next tap, which reads the real output first.

## The orb shadow at the other end

The orb shadow strip (`.header-fade-strip`, `specs/header-fade.md`) now has a
mirror at the opposite end of the screen: the same colour, the same theme
opacity, the same `--nova-header-fade` scroll fade.

- Portrait: the existing strip is the top; the mirror is the **bottom**, same
  height (`--nova-avatar-size`), gradient `to top`.
- Landscape: the existing strip is the left sidebar edge; the mirror is the
  **right** edge, same width (`--dashboard-sidebar-width`), gradient `to left`.
- It is `<div className="header-fade-strip header-fade-strip-end">`, rendered
  by `HeaderFadeStrip` (dashboard home only; the config page keeps its single
  strip). `pointer-events: none`, `z-index: 90`, below the buttons.

## Removed

- `ops/kiosk/nova-kiosk-orient.py`, `ops/kiosk/nova_kiosk_orient/`,
  `ops/kiosk/nova-kiosk-orient.service`, the cached `ops/kiosk/models/yunet.onnx`.
- `deploy-kiosk-orient.ps1` (workspace root); `deploy-kiosk-rotate.ps1` replaces
  it and installs the service. It needs no API key, no OpenCV and no model.
- On Nocturnium: the `nova-kiosk-orient` user unit, `~/.config/nova-kiosk/orient.env`
  and `/var/lib/nova-kiosk-orient/` (including the one retained camera frame).

## Deployment

- Dashboard: merged to `main`, then the host's update channel
  (`specs/self-update-channel.md`); the force-update endpoint is called after
  the merge so the host fetches it now (`specs/update-force-endpoint.md`).
- Kiosk service: `deploy-kiosk-rotate.ps1` at the workspace root. The kiosk's
  Brave stays on its existing launch; the service attaches to it.
- `localStorage["nova.dashboard.displayRotation.v1"] = "true"` is set on the
  kiosk page over CDP, once.

## Done means

- `displayRotationSetting`, `autoRotationSensing` and the button have unit
  tests: absent key is off; stored true plus a self-rotating device shows no
  button; the button renders only when allowed; a click calls
  `window.novaKioskRotate` once.
- The switch is disabled with its reason on a self-rotating device.
- At 1280x720 the button is bottom right; at 430x932 it is bottom left. It
  fades with the other header buttons and is not clickable once they are not.
- The strip's mirror is present at the bottom (portrait) and the right
  (landscape) and fades with the first.
- On Nocturnium: `systemctl --user is-active nova-kiosk-rotate` is `active`,
  one call to `window.novaKioskRotate` over CDP moves `kscreen-doctor -o`'s
  rotation one step, and the page lays out in the new orientation.
- The dashboard `typecheck`, unit tests and the repo's file-size ratchet pass.
