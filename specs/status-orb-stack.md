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
  **dial**, and dragging around the orb steps through the stack. Turning toward
  the low end reaches the top entry; toward the high end, the lowest-priority
  entry. One detent per entry.
- Content changes **slide** between entries in the turn direction (about 220 ms,
  ease-out), clipped to the orb face with a soft opacity fade at the edges (a
  mask, no hard edge).
- Keyboard: Enter/Space opens the dial; arrow keys step; Escape closes.
- Apple TV shows the same ordering (display only, no dial).

#### The dial is the RotaryEncoder indicator

Adeline, 2026-09-16 (plan `piped-wondering-mountain`): "the tap-and-dial
function for the status orb ... should just be the existing dial indicator and
lines that appear when we enable a temperature dial, following the same display
rules."

- The orb no longer draws its own ring and position mark. It renders the
  **`RotaryEncoder` indicator layer** — the sunken ring and the index line — in
  the accent colour, exactly as the temperature dial does, and
  inherits `specs/color-encoder.md`'s tuck-away rules verbatim: a tap of
  60–400 ms with under 5 px travel unlocks; the indicator re-locks after 5 s
  idle; a pointer-down outside locks it at once; Escape locks; Enter/Space
  unlocks. The orb's own `ORB_DIAL_DEFOCUS_MS` timing is the same 5 s, so the
  visible behaviour of the timeout does not change.
- **No LEDs on the orb** (Adeline, 2026-09-16). The knob's lights are not
  carried over: the orb face is a readout, and the lights sat on top of it. The
  index line alone marks the entry on show, its angle taken from the entry's
  position in the stack.
- **De-focusing reverts to the preferred display order immediately.** The
  separate 10-second `ORB_DIAL_RETURN_MS` linger is removed: when the dial
  locks, the orb slides straight back to the top of the order computed by
  `orderOrbStack`, with the same 220 ms animation.

#### The dial never drags the page

Adeline, 2026-09-16: "when rotating this dial, it should not drag the page
around. page scrolling should not be possible if the first tap was in the status
orb."

- **Any press that starts anywhere on the orb blocks page panning**, whether or
  not the dial is unlocked, and for the whole gesture.
- The mechanism is the one `RotaryEncoder` already uses: the orb host is marked
  non-draggable so `useClickDragScroll`'s `startsInNonDraggable` refuses to arm
  a page pan (`role="slider"` / `data-nova-no-drag-scroll`). `touch-action:
  none` alone is not enough — it stops native touch scrolling but leaves the
  mouse drag-pan armed, which is why the orb dragged the page before this.

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

## Round 3: the gym alert sinks (Adeline, 2026-09-16)

The gym alert is the exception to alert priority: it goes **at the bottom of
the stack, always**, below running countdowns and below plain `on` entries. A
running timer sits above it, as does everything else. The justification is that
a gym alert is typically a week old and clearing it needs physical work, so it
is never the most useful thing on the orb at the moment it fires.

- Ordering becomes: other alerts (most recent first) → countdowns (shortest
  remaining first) → `on` entries in user order → **gym alerts** (most recent of
  them first, when more than one gym module is on the stack).
- Applies to both gym modules, `gym` and `gym-progress`
  (`ORB_SINKING_ALERT_MODULE_IDS` in `lib/orb-info/stack.ts`, mirrored by
  `OrbStackOrdering.sinkingAlertModuleIDs` on Apple TV).
- A sunk gym alert still alerts: it keeps its alert colour and pulse on the dial,
  it just no longer takes the orb's resting slot from anything else.
- Done means: the shared case table in `lib/orb-info/stack-cases.json` covers a
  gym alert ordering below a countdown and a plain `on` row, and two gym alerts
  ordering among themselves; both the web tests and the Apple TV parity self
  tests run it.
