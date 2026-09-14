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
