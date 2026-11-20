<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Kiosk backlight: wake on touch, dim, then off

alex, 2026-11-20 (ticket 005934; the per-period settings, ticket 098424). No plan-mode plan file: the request named
every number, so it went straight into this spec, the same way
`kiosk-display-rotation.md` did. Every number below is from her message unless
it is marked **Decision**.

> the goal is to eliminate backlight glow overnight, as the lounge is now my
> bedroom.

## The behaviour

| phase | what the panel does | how long |
|---|---|---|
| **rise** | brightens from where it is to the target | **2 s** |
| **hold** | stays at the target | until **30 s** after the last touch |
| **dim** | fades linearly from the target to the period's **dim level** | **30 s** |
| **dark** | holds at the dim level | **120 s**, or until a touch when "blank the screen when dim" is unset |
| **off** | only with "blank the screen when dim": blank, backlight at 0 and the page solid black (see below) | until a touch |

### Settings, per period

Two periods, by the lighting's adaptive rule: **day** while the sun is up,
**night** while `sun.sun` is `below_horizon`. Each has three settings
(alex, 2026-11-20: *"two different dim targets for night and day, and allow
the user to choose whether each one fully disables the backlight when dim"*;
the first version dimmed to 0% by day too, *"that wasn't the intent"*):

| setting | range | day default | night default |
|---|---|---|---|
| **Brightness**: the lit target | 1-100% | 100% | 60% |
| **Dim to**: where the fade ends | 0-100%, at most Brightness | 30% | 0% |
| **Blank the screen when dim**: go blank 120 s after reaching the dim level | on/off | off | on |

The defaults are the lighting's adaptive values for Brightness and the first
version's night behaviour; **Decision**: 30% for the day dim. A dim level above
Brightness is clamped to it. They live in `preferences.kioskBacklight`
(`{day, night}`, each `{brightnessPct, dimPct, offWhenDim}`), written whole by
`POST /api/kiosk-backlight` and normalised by `lib/kiosk-backlight/settings.ts`.
They are set in the config page's **Kiosk Display** accordion (Devices), shared
by every screen: set from any device, acted on only by a kiosk running the
service.

**Why "off" is blank and not powered off** (measured 2026-11-20): on Nocturnium,
powering the display off (DPMS off) disconnects the touchscreen. Its Melfas
"Incell" touch layer is a USB device inside the LCD, and with the panel off it
drops off the bus (`/dev/input/event4` vanishes and re-enumerates on DPMS on).
Nothing could then wake the screen by touch, not even KWin's double tap. So
**by default** the off phase keeps the panel powered, leaves the backlight at
its hardware minimum (KDE 0 = raw 1 of 65535), and the page covers itself in
solid black, which cuts what light is left by the LCD's contrast. The touch
keeps working, so one tap wakes it. `BACKLIGHT_OFF_MODE=dpms` powers the display
off instead, for a panel whose touch survives that.

- **Any touch** anywhere on the panel starts a rise, from whichever phase it is
  in. A touch during the hold restarts the 30 s. A touch during the dim rises
  from the level the dim had reached.
- **The target is the current period's settings.** When the sun changes, or a
  setting is saved, while the panel is lit it rises or falls to the new target
  over 2 s. While it is dimmed, dark or blank, a change applies at once only if
  it makes the panel darker: a lower dim level fades on down over 30 s, and
  blank newly set starts its 120 s. A change that would brighten an idle panel
  (sunrise, a higher dim level, blank turned off) waits for the next touch, so
  nothing lights the bedroom while she sleeps. **Decision** (idea review,
  ticket 098424).
- **Config labels** (Devices, **Kiosk Display**): per period a "Brightness"
  slider (1-100%, 1% steps), a "Dim to" slider (0% to Brightness, 1% steps;
  below 25% it notes that a tap there only wakes the screen; at 0% without
  blank, that the page still shows faintly) and a "Blank the screen when dim"
  checkbox ("2 minutes after it dims: black, at the lowest backlight").
- **One tap wakes the panel from off.** That tap does nothing else.
- **In dpms mode, a wake from anything else** (KWin's own wake, a keyboard, a
  system resume) is treated as a touch: the panel rises to the target.
- **A tap on a panel too dim to read only wakes it.** It does not reach the
  control under the finger, because she cannot see what is there. **Decision**
  (idea review, ticket 005934): "too dim" is a level, not a phase: below
  **25%**, or blank. It holds until the rise passes 25%, plus **500 ms**,
  so the tap that started the rise does not land on a control. A tap at or
  above 25% during the dim works normally and also brightens the panel.
- **A wake needs a real contact** (the touchscreen's `BTN_TOUCH` going down),
  not just any touch event, and touches in the **2 s** after the service changes
  the display's power are ignored, because the panel can report noise on a
  power change. **Decision** (idea review).
- **Decision**: ramps are linear in KDE's brightness scale, stepped at 20 Hz.
  On a wake from off the 2 s rise starts once the display reports it is on
  (waiting at most 2 s), so the ramp is not spent on a dark panel.

### Current defaults that are hers to change

Nothing but input wakes or holds the panel: not notifications, reminder
chimes, a camera view or DVR playback, media or a voice session. A camera view
left open dims like anything else, by day too. The doorbell has no dashboard
popup today (the server broadcasts `doorbell-alert` and no page handles it), so
it is not affected. These follow her message ("tapping the dashboard anywhere")
and the bedroom goal; they were decided, not asked, and are listed here so
they are not mistaken for a settled preference.

## How it works

Two parts, the same split as the rotate button: a user service on the kiosk
holds the timing and drives the hardware, and the dashboard page supplies the
target and handles taps.

### The service: `ops/kiosk/nova-kiosk-backlight.py`

A **user** unit (`nova-kiosk-backlight.service`), because brightness and DPMS
go through the Wayland session.

- **Brightness**: KDE's `org.kde.ScreenBrightness`
  `/org/kde/ScreenBrightness/display0` `SetBrightness(value, 1)`, value
  `0..MaxBrightness` (10000 on Nocturnium), flag 1 hides the on-screen
  indicator. KWin owns the panel's backlight, so it is set through KDE, never
  by writing sysfs (KWin would put its own value back). KDE 0 is raw 1 of 65535
  on the Nocturnium panel; the page's black cover is what removes most of the
  rest.
- **Display power** (dpms mode only): `kscreen-doctor --dpms off` / `--dpms
  on`. State is read from `/sys/class/drm/*/dpms` of the internal panel
  (`On`/`Off`), which follows KWin's DPMS, polled every 0.5 s.
- **Touch**: the touchscreen's evdev node (the first input device udev marks
  `ID_INPUT_TOUCHSCREEN=1`, found from `/run/udev/data` on every open, never by
  node number, which can change across boots), read without grabbing it, so
  KWin still receives every event. While it rises or holds, any event refreshes
  the 30 s (a finger still dragging a dial); a wake from dim, dark or off needs `BTN_TOUCH` down. A read error
  or a vanished node closes it, counts as a touch (fail lit), except while the
  display is powered off in dpms mode (where the touchscreen is expected to
  vanish), and it is looked for again every 5 s. Reading the node directly is
  needed because KWin hands touches to the page only while the display is on,
  and wakes a powered-off screen from touch only on a **double** tap that it
  swallows (`DoubleTapWakeup`, kwin `src/dpmsinputeventfilter.cpp`).
- **Page link**: a CDP Runtime binding `window.novaKioskBacklight` on the kiosk
  page (port from `BACKLIGHT_CDP`, default `http://127.0.0.1:9223`; page chosen
  by `NOVA_BACKEND_URL` in `~/.config/nova-kiosk/backend.env`, as the rotate
  service does). The page calls it with JSON:
  - `{"target": <percent 1-100>, "dim": <percent 0-100>, "off": <bool>}`: the
    current period's Brightness, Dim to and Blank the screen when dim. `dim` and `off`
    (Dim to, Blank the screen when dim) are optional (an older page sends only `target`; then `dim` is 0 and `off`
    true, the first version's behaviour).
  - `{"activity": true}`: input the service could not see (a mouse or
    keyboard on a kiosk without a touchscreen).
  On every phase change, whenever `dark` flips, and when it attaches to a
  (re)loaded page, the service sets `window.__novaKioskBacklight` to
  `{"phase": "<rise|hold|dim|dark|off>", "level": <percent>, "target":
  <percent>, "dim": <percent>, "off": <bool>, "dark": <bool>, "blank": <bool>}` and dispatches a
  `nova:kiosk-backlight` event with the same detail. `dark` is the swallow test
  (below 25% or off). `blank` is true in the off phase in blank mode: the page
  covers itself in black. On a wake from off it adds `"woke": true`.
- **Starting state**: when the service starts, it treats the start as a touch
  (rise to the last target, kept across reboots with the dim level and the
  off setting in `~/.config/nova-kiosk/backlight-target.json`, default 100%,
  0%, on), so a restart
  never leaves the panel dark with no timer running. The page sends no target
  until its dashboard state has loaded, so it never guesses daylight at night.
- **Failing lit**: `Restart=always` (2 s), and `ExecStopPost` runs
  `nova-kiosk-backlight.py restore`, which turns the display on at the last
  target, so a crash or a stop never leaves a black panel. The page's black
  cover cannot outlive the service either: any tap on it lifts it in the page
  itself (below).
- **Hold switch**: while `~/.config/nova-kiosk/backlight.hold` exists the panel
  stays at its target and never dims (for an agent or a person working at the
  kiosk). `systemctl --user stop nova-kiosk-backlight` restores a lit panel
  and stops the cycle.
- **powerdevil**: at start the service sets `[AC][Display]
  DimDisplayWhenIdle=false` again if a Plasma upgrade has reset it, and logs
  that it did.
- **Without the page** the service still works: touch, dim, off and wake run
  on its last known target.

Settings, all environment variables with defaults: `BACKLIGHT_CDP`,
`BACKLIGHT_RISE_S=2`, `BACKLIGHT_HOLD_S=30`, `BACKLIGHT_DIM_S=30`,
`BACKLIGHT_OFF_AFTER_S=120`, `BACKLIGHT_SWALLOW_BELOW_PCT=25`,
`BACKLIGHT_OFF_MODE=blank` (or `dpms`),
`BACKLIGHT_TOUCH_DEVICE` (empty = autodetect), `BACKLIGHT_DRM_CONNECTOR`
(empty = the first connected eDP/LVDS/DSI connector).

### The page: `app/components/dashboard/useKioskBacklight.ts`

Mounted once from `Dashboard.tsx`. It does nothing until
`window.novaKioskBacklight` exists, so every other device is unaffected and no
setting is needed: the service's presence is the switch.

- Sends `{"target", "dim", "off"}` for the current period (from
  `preferences.kioskBacklight`, defaults when unset) when the binding appears,
  when the sun or the settings change, on every `nova:kiosk-backlight` event
  carrying `woke` (that is the page "looking for" the wake, so it resumes its
  target on a system wake), and whenever the service reports values different
  from its own.
- Swallows `pointerdown`, `pointerup`, `mousedown`, `mouseup`, `click`,
  `touchstart` and `touchend` in the capture phase while the service reports
  `dark`, and for 500 ms after it stops, with `preventDefault` and
  `stopImmediatePropagation`. The service repeats its state every 5 s while
  dark; after **15 s** with no word the page treats it as gone (its restore has
  lit the panel) and stops swallowing, so a stopped or crashed service never
  leaves a lit dashboard that ignores taps.
- Sends `{"activity": true}` on `pointerdown` and `keydown` (throttled to one a
  second).
- Draws a fixed, full-screen, solid black cover above everything while the
  service reports `blank`, and removes it as soon as it does not, or as soon as
  any tap lands on it, whatever the service says, so a service that died while
  blank cannot leave a black screen. The tap itself is swallowed; the service
  sees it through evdev and rises.

### Installing: `ops/kiosk/install-kiosk-backlight.sh`

Run on the kiosk as its user (uses `sudo` for the udev rule):

- installs the service under `/opt/nova-ha-dashboard/ops/kiosk/` and the unit
  into `~/.config/systemd/user/`, enables and restarts it;
- installs `ops/kiosk/70-nova-kiosk-touch.rules`
  (`ID_INPUT_TOUCHSCREEN=="1"` gets `TAG+="uaccess"`, so the seat's active user
  can read the touchscreen) and re-triggers udev for input devices;
- turns off powerdevil's own idle dim (`[AC][Display] DimDisplayWhenIdle=false`
  in the kiosk user's `powerdevilrc`, then `refreshStatus`). Left on, it
  multiplies the panel down to 30% after 60 s idle and fights the ramps. The
  previous value is saved to `~/.config/nova-kiosk/powerdevil-dim.prev`.
- is idempotent; `--uninstall` stops and removes the unit and the udev rule
  and restores the saved powerdevil value.

## Done means

- On Nocturnium, with nobody touching it: lit, then dim over 30 s from the
  30 s mark, dark at 60 s, blank (black cover, backlight at minimum) at 180 s.
- One tap on the blank panel lifts the cover and rises to 60% at night, 100% by day,
  in 2 s, and does not operate the control under the finger. Neither does a tap
  at 10% during the fade.
- The service and the page both survive the other restarting, and killing the
  service at 0 leaves a lit panel.

## Out of scope

- A This Device setting or config page control for the timings.
- Ambient-light sensing (the panel has none).
