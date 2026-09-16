# Status orb priority stack, timer and washing ETA

Plan identifier: `make-the-status-orb-silly-micali`. This random codename does not
request a silly appearance: preserve the existing orb style.

## Requirements

**Priority stack**
- Preference becomes an ordered list of entries; each entry = module id + display + params + activation. Highest *active* entry wins; one entry shows at a time.
- Activation: `always` (gym, clock, CPU…) or `whenAlerting` — **any existing module** can be set to only take the orb while its alert is true. An `always` entry blocks everything below it.
- Event entries (washing, timer, rain, power, update) are inherently "active only when their condition holds".
- Config editing: rows with drag handles, Add-entry via grouped `ConfigSelect`, remove, each row expands into its existing display/params editor.
- Migration: existing `moduleId` becomes a one-entry list.

**Orb rendering of event entries**
- Icon + text (remaining time). Timer additionally draws a countdown ring around the icon.
- Ring: alert colour; starts full at 12 o'clock and depletes **counter-clockwise** — nearly full = arc from 12 clockwise round to 11; last remaining arc = 12→1.
- On completion: ring vanishes, icon remains, orb alert-flashes until tapped.
- While any tap-to-dismiss alert (timer or wash) is showing, an orb tap **dismisses** it everywhere and does not start push-to-talk.

**Washing entry**
- Active while a wash claimed by the **primary user** is running, and after it completes until acknowledged.
- Config: `dashboard.people` gains a `primary` flag (exactly one); the dashboard serves that user. Wash heuristics are the primary user's (`autoAttribution`).
- ETA: count down to the primary's typical wash duration (new config `typicalMinutes`, Adeline 66). Once exceeded, show elapsed overrun counting up (e.g. `+0:07`) — no re-guess.
- On completion: orb flashes; orb tap acknowledges the wash (same effect as acknowledging its reminder).
- **If the stack contains a washing entry, the temporary wash reminder icon is not displayed.** Existing wash sound choice and Discord message stay; orb-backed sound repeats as specified below.

**Timer**
- One timer, server-side household state: every screen's orb and set-timer control show the same countdown; completion handled server-side so Discord fires with no screen open.
- Timer holds its own position in the priority list (`timer` entry).
- Range: logarithmic ring, 1 min → 8 h. Steps: 1-min to 10 min, then coarser even divisions switching at major points (proposal to record: 5 min to 60, 10 min to 2 h, 15 min to 4 h, 30 min to 8 h). Below 1 min = Off. Ring value tap opens `NumericEntryPopover` for exact entry.
- Icon list is **user-defined** in config (pick + order glyphs via `ReminderIconPicker`).
- Completion: sound plays **every 30 s for 5 min, then silent**, orb still in alert mode. Tapping the orb on any device dismisses it everywhere (sound stops everywhere).
- Sound chosen in the **theme** from a dropdown. Preload: the six MP3s in `D:\Downloads\Windows Sounds\` (Chime, Magical, Motion tracker, Retro boop, Soft boop, Tink) — ignore the WAVs.
- Discord on completion: names the icon's timer type and the duration, e.g. "Egg timer finished — 6 min".
- Dragging the timer ring to zero cancels: removed from orb, **no** sound, **no** Discord.

**Set-timer control (RotaryEncoder variant, `TimerEncoder`)**
- Location: System → Reminders sub-panel, **above** the reminder lists. Today/Upcoming lists move into that panel's `AdvancedFold` advanced area. Nothing else from reminders goes on the orb.
- Flow: tap to activate (unlock) → drag knob to step through icons (selected icon in the centre) → drag the outer timer slider ring past Off → de-focus (or idle timeout) starts it. Any non-zero value starts on de-focus.
- While running: control is locked and counts down itself — remaining time on the face and the same counter-clockwise alert-colour ring around its icon.
- Tap the control (not the orb) to unlock and show the timer ring again for adjusting/cancelling.
- Apple TV: displays the stack incl. timer/wash; **no timer setting on Apple TV** yet.

**New event entries** (params with these defaults)
- Rain arriving: active when rain chance ≥ 50 % within next 60 min (hourly forecast); umbrella icon + minutes until rain.
- High power draw: active above 3.0 kW sustained 2 min; bolt icon + kW.
- Nova update running: active while a self-update (`/api/update`) is in progress; spinner icon.
- Visitor at the door: **shelved** (needs new hardware).


## Resolved completion behaviour

Owner clarification, 2026-09-14: washing and timers use the same behaviour.
When the corresponding entry is configured in the orb stack, chime every 30
seconds for five minutes, then remain silently alerting until an orb tap
acknowledges the occurrence on every screen. Suppress that occurrence's temporary
reminder icon. If no corresponding orb entry is selected, show the temporary
task icon and chime once. A higher-priority entry temporarily hiding an event
does not mean the event is unconfigured. Cancellation is always silent.

The other plan proposals are the implementation defaults: minute divisions
1 to 10, 5 to 60, 10 to 120, 15 to 240, 30 to 480; five-second idle start;
update-running covers in-app self-update only.

## Acceptance

Highest active row wins on web screens and Apple TV. Reordering and editing
preserve sibling entries, including duplicate modules; legacy moduleId settings
migrate to one row. Timer set, adjust, silent cancel, countdown, completion,
shared dismissal and server-side Discord delivery all work. Full ring begins
at twelve, remaining arc runs clockwise from twelve, and its endpoint recedes
counter-clockwise; completed rings disappear. Primary-user wash ETA becomes
an elapsed overrun after the configured typical duration without re-guessing.
Orb taps dismiss displayed completion alerts before push-to-talk. Apple TV
supports display and dismissal, with no timer-setting UI.

Verify pure stack/preferences, timer lifecycle and logarithmic-step functions;
exercise two browser tabs, persisted configuration, sound expiry, server-only
completion and Apple TV display. Deploy dashboard, Discord module and Apple TV
in that order, subject to the shared deployment-chain coordination.

## Round 2 (Adeline, 2026-09-15)

Plan `we-ve-separated-the-landscape-s-ancient-parnas` round 2, task log
`20260914T101019Z-06c0031b`. Supersedes "Highest active row wins", the
`always` / `whenAlerting` activation, and orb push-to-talk.

### Entry kinds and states

- **Countdowns** are `timer`, `washing` (ETA / overrun) and `rain-arriving`
  (minutes until rain). They are interchangeable: among running countdowns, the
  **shortest remaining** shows first. A washing overrun (`+0:07`) counts as zero
  remaining. A countdown's row position in config does not order it.
- Every other entry is **non-countdown** and has a state evaluated each tick:
  - `off`: not in the stack at all.
  - `on`: in the stack, in the user's arranged order.
  - `alert`: raised to the top.
- The entry's config holds `enabled` (user switch). A disabled entry is always
  `off`. An enabled entry is `on` unless its module says otherwise:
  - **Gym**: `off` until 24 h since the last session (`showAfterHours`, default
    24), `on` from then, `alert` from its configured alert threshold.
  - Modules with an alert condition: `alert` while it holds, else `on`.
  - Modules without one: `on`.
- A countdown whose condition has completed (finished timer, completed wash) is
  an alerting entry, not a countdown.

### Order

1. Alerting entries (finished timer, wash done, due reminder, any module in
   `alert`); among themselves, most recent alert first.
2. Running countdowns, shortest remaining first.
3. `on` entries, in the user's arranged order.

The first entry is what the orb shows at rest. The config page keeps the
drag-to-arrange list; each non-countdown row gets an enabled switch; countdown
rows are marked as countdowns and are not ordered.

Legacy migration: `activation: "always"` becomes enabled; `whenAlerting`
becomes enabled with `showOnlyWhenAlerting: true` (never `on`, only `alert`).

### The dial

- **Orb push-to-talk is removed.** Wake word and other voice entry points stay.
- A single tap on the orb, when the entry on show is not alerting, opens the
  **dial**: a thin ring with a position mark in the accent colour appears, and
  dragging around the orb steps through the stack. Turning toward the low end
  reaches the top entry; toward the high end, the lowest-priority entry. One
  detent per entry.
- Content changes **slide** between entries in the turn direction (about 220 ms,
  ease-out), clipped to the orb face with a soft opacity fade at the edges (a
  mask, no hard edge).
- The dial **defocuses after 5 s** without touch, or when focus moves elsewhere
  (tap outside, another control focused, page hidden).
- **10 s after the last touch** the orb slides back to the first entry with the
  same animation.
- Keyboard: Enter/Space opens the dial; arrow keys step; Escape closes.
- Apple TV shows the same ordering (display only, no dial).

### Tapping an alert

- A tap on the orb while the entry on show is **alerting** dismisses that
  occurrence **on every screen**, with the dial open or not: a finished timer, a
  completed wash, and **due reminders** (same effect as acknowledging the
  reminder's tile or alert). It never opens the dial.
- Dismissal is server-side and broadcast on the dashboard event stream; every
  open screen drops the alert and stops its sound on the next event delivery.
  Reported 2026-09-15: a dismissal had to be repeated on several devices. That
  is the defect to fix.

### Gym display

- The gym entry shows a **weights icon** (Phosphor `Barbell`) above its value,
  laid out like the timer entry: icon above, text below, text scaled down to fit
  the face at the sizes the timer uses.

### Done means (round 2)

- Unit tests for ordering: alert beats countdown beats on; two countdowns order
  by remaining; off never appears; gym off/on/alert at 23 h / 24 h / threshold.
- Orb tap opens the dial; dragging steps entries; 5 s defocus; animated return
  to the top after 10 s.
- A tap on a finished timer, completed wash or due reminder dismisses it in two
  open browser contexts at once.
- Gym shows the barbell icon with fitted text.
- Apple TV conformance cases updated for the new ordering.
