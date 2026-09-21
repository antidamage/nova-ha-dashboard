# The Amp: its own meter category, and its power follows the Apple TV

Adeline, 2026-09-19. Task log `20260919T120947Z-458dcadf`. No plan codename —
this was a direct request, not a plan-mode run; the spec is still written first
(CLAUDE.md, "Every plan writes a spec as its first task").

The floating meter has been moved onto the **amp**. Three things follow from
that:

1. The amp gets its **own floating-meter category**, so what it draws is
   measured rather than buried in Home Entertainment's average.
2. The plug that measures it is also the plug that **powers** it, so the amp
   can be switched with the Apple TV — on when the Apple TV is on, off when it
   is off.
3. Switching it at all means the always-on guard of
   [power-meters.md](power-meters.md) §1 has to stand down while this is
   happening, and take the plug back the moment it stops.

| File | Holds |
|---|---|
| `lib/config-schema/power.ts` | `power.ampPowerControl`, the `amp` category icon |
| `nova-household/dashboard-config.json` | the `amp` category and this house's control config |
| `lib/amp-power-control.ts` | the decision, the rate limit, the loop |
| `lib/amp-inputs.ts` | the decision's inputs: the Apple TV's power state and audio output, the plug's own |
| `lib/power-meter-guard.ts` | stands down on entities the controller owns |
| `lib/power/meters.ts` | `readActiveFloatingCategoryId()`, the automation switch |
| `app/components/dashboard/power/FloatingMeterCard.tsx` | the confirmation dialog, the "Automate state" switch |
| `app/api/power/amp-automation/route.ts` | writes the switch |
| `ops/homeassistant/nova_appletv_outputs` | the audio-output bridge (§8) |
| `instrumentation.ts` | starts the controller |

## 1. Where the Apple TV's power state comes from

Adeline asked for **pyatv**. Home Assistant's `apple_tv` integration *is*
pyatv — it is the library's primary consumer — and it is **already configured
on this house's HA** with Companion credentials paired against the Home Theatre
Apple TV 4K (`94020663-50DB-442B-9355-78C9DDCA0C94`, 192.168.8.120, tvOS 26.6).
It owns three entities:

```
media_player.home_theatre                         (platform: apple_tv)
remote.home_theatre                               (platform: apple_tv)
binary_sensor.lounge_home_theatre_keyboard_focus  (platform: apple_tv)
```

So Nova reads `media_player.home_theatre` from HA rather than opening a second
pyatv session. This is not a workaround, it is the better build:

- A second Companion connection to the same Apple TV would compete with HA's
  for the device's session, and pairing a new one needs a PIN read off the TV
  screen — a person, standing in the lounge, every time credentials are reset.
- Reading an HA entity id from household config is the same shape as every
  other device Nova touches, and keeps product code free of machine-specific
  detail (`feedback_dashboard_no_machine_specific_code`).
- `pyatv`'s power state arrives as a push update inside HA, so Nova sees the
  change on its next 5-second tick rather than waiting out a poll.

**If the integration is ever removed**, the entity goes `unavailable` and §4.4
applies: the amp is restored to on and left alone. Nothing breaks quietly.

### 1.1 What "on" means

Adeline's choice: **powered on**, not "playing". Idle menus, the screensaver
and AirPlay all keep the amp up; a pause does not cut it mid-film.

The `apple_tv` media player reports `off` (and, on some HA versions,
`standby`) when pyatv's `power.power_state` is `PowerState.Off`. Everything
else it can report — `idle`, `playing`, `paused`, `buffering`, `on` — means the
device is awake.

So the mapping is expressed as **off-states, not on-states**:

| Entity state | Desired amp state |
|---|---|
| any state in `offStates` (default `["off", "standby"]`) | **off** |
| `unavailable`, `unknown`, entity missing | **no opinion** (§4.4) |
| anything else | **on** |

Listing the off-states rather than the on-states means a future HA release
inventing a new playing-ish state keeps the amp on, which is the safe
direction to be wrong in.

## 2. The Amp category

Added to `power.floatingMeter.categories`:

```jsonc
{ "id": "amp", "label": "Amp", "icon": "amp",
  "seedWatts": 120, "suppressesBaseLoads": [],
  "members": ["Amp", "Sub + amp"] }
```

- `icon: "amp"` is a new member of the fixed icon enum in
  `lib/config-schema/power.ts`, mapped by `FloatingMeterCard` to lucide's
  `AudioLines`. Config still names no component.
- **`seedWatts: 120`** — Adeline's figure, used only until the category has
  `minLearnedHours` (24 h) of its own measurement, after which §3.3 of
  power-meters.md takes over and the seed is never read again.
- `suppressesBaseLoads: []` — the amp is not a modelled base load, so there is
  nothing to withhold and the grid total does not move when the meter arrives.
- **"Amp" and "Sub + amp" are removed from `home_entertainment`'s members.**
  Membership is the panel's description of what a category covers; leaving them
  in both would describe the amp as measured twice.

Home Entertainment keeps its own learned history. It was measuring the amp
until now, so its profile is high by roughly the amp's draw until it is next
selected and re-measured. That is the ordinary cost of moving the meter and
§3.3's recency weighting (28-day half-life) works it out; no reattribution is
run, because the amp genuinely was part of that group's draw for that period.

## 3. Measuring the amp

Nothing new. The amp category is measured exactly the way the other three are
(power-meters.md §3.3): while it is the active category the live plug reading
is its watts at `measured` confidence, and every sample folds into its
hour-of-day profile, so after a day it reports `high` from its own history
whenever the meter is elsewhere.

Its MQTT sensor `nova_power_floating_amp_estimated_power` appears on the
`Nova Grid` device through the existing publish path (power-meters.md §6) with
no code change — that loop is per-category already.

## 4. The controller

`lib/amp-power-control.ts`. One tick every `pollIntervalSeconds` (5), started
from `instrumentation.ts` beside the meter guard.

### 4.1 Config

```jsonc
"ampPowerControl": {
  "categoryId": "amp",
  "sourceEntityId": "media_player.home_theatre",
  "offStates": ["off", "standby"],
  "switchEntityIds": ["switch.tuya_mobile_floating_meter", "switch.floating_meter"],
  "minIntervalSeconds": 30,
  "pollIntervalSeconds": 5,
  "staleRestoreSeconds": 600
}
```

Absent config means the feature does not exist: no loop, no ownership, and the
meter guard behaves exactly as power-meters.md §1 describes. A generic install
carries the code without the behaviour.

`switchEntityIds` repeats the floating meter's ids, most current first, for the
same reason `AlwaysOnMeter` does — a re-paired Tuya device answers on a
different id (`lib/ha/twins.ts`). Every listed id that HA knows about is
commanded.

### 4.2 The gate — the controller is inert unless the Amp category is selected

Adeline, mid-build: *"it should ONLY EVER power on or off the floating meter in
response to the apple tv if that category is selected."*

Every tick begins by reading `floatingMeter.activeCategoryId` from
`data/power/state.json`. If it is not `categoryId`:

- the controller issues **no switching command of any kind**;
- it **releases ownership**, so the meter guard resumes and the plug is
  on-and-guarded within at most 60 seconds (§5);
- the forced-on restore that goes with that release **counts as a switching
  command**, so re-selecting Amp waits out the full interval before the amp
  starts following the Apple TV again (§4.6).

This is the whole safety argument for the feature. The plug is only ever
allowed off while it is demonstrably measuring the amp, because that is the
only arrangement in which "off" means the amp is off rather than some other
group of devices being cut.

### 4.3 Handing the plug back

When the category moves **away** from Amp (§4.2, first tick after the change,
so within 5 seconds), the controller issues one `switch.turn_on` on every
configured id and then goes inert.

The restore itself **is immediate**, and that is deliberate: it is not a
tracking change following the Apple TV, it is the controller putting down
something it is no longer entitled to hold. The always-on rule is the stronger
claim, and power-meters.md §1 already grants it "no dwell, no backoff". The
guard would restore the plug within 60 seconds anyway — this just makes the
handback immediate rather than leaving the amp dark for up to a minute after
the meter has been reassigned.

**But it counts as a switching command.** `lastCommandAt` is stamped, so
anything that follows — including re-selecting Amp a second later — waits out
the full interval. Without that, moving the category away and straight back
produced an on-then-off pair 16 seconds apart (observed live on 2026-09-19,
13:21:44 on, 13:22:00 off), and Adeline's rule has no exception in it: state
changes NEVER occur more frequently than once every 30 seconds. The only
sub-interval gap that remains possible is off-then-restore, which is the safety
rule she wrote herself.

The same forced-on release happens when the config is removed, and on the
staleness path of §4.4.

### 4.4 When the Apple TV cannot be seen

`unavailable`, `unknown` or a missing entity is **not** "off" — the same
discipline the meter guard applies to an off-network plug. There is no desired
state, so no command is issued and the amp stays where it is.

If that persists for `staleRestoreSeconds` (**600**, ten minutes), the
controller treats the source as dead: it forces the plug **on** (as §4.3) and
stays inert until the entity reads live again. A dead `apple_tv` integration
must not be able to leave the amp switched off indefinitely.

The ten-minute window is long enough that an HA restart — which takes the
entity unavailable for a minute or two — does not flap the amp.

### 4.5 The decision, and why it is level-triggered

`decideAmpAction()` is a pure function of (desired state, actual switch state,
time since the last issued command, the minimum interval). It is exported and
tested on its own; the loop does IO and nothing else.

The controller compares the desired state against **what the switch actually
reads in HA**, not against what it last commanded. Two consequences, both
wanted:

- A command that did not take (a dropped Tuya call) is retried on the next tick
  the rate limit allows, instead of the amp sitting in the wrong state until
  the Apple TV next changes.
- A person switching the plug in HA while the Amp category is selected is
  corrected back to following the Apple TV. That is a standing override, and it
  is the same standing override power-meters.md §1 already establishes for this
  exact plug — the narrow scope (`ampPowerControl.switchEntityIds`, gated on
  the Amp category) is what keeps it from generalising into the thing
  `lib/lighting-convergence.ts` refuses to be.

**Being level-triggered is also how the coalescing Adeline asked for falls
out.** The controller holds no queue of transitions. It only ever asks "what
should the plug be, right now, and is it that?", so:

- on → off → on inside one 30-second window issues **nothing at all**: by the
  time the window expires the desired state equals the actual state again, and
  the superfluous pair has vanished rather than been replayed;
- on → off inside the window issues the **off** when the window expires, once;
- a burst of ten changes issues at most one command, carrying only the final
  state.

A queue of pending transitions would have to be de-duplicated, ordered and
expired to reach the same answer. Not keeping one is strictly simpler and
cannot drift out of step with the device.

### 4.6 The rate limit

**No switching command is ever issued within `minIntervalSeconds` (30) of the
previous issued one.** The clock starts when a command is *issued*, not when it
succeeds — a failed call still consumed a switching opportunity at the plug,
and retrying it immediately is exactly the hammering the limit exists to stop.

The first command after the controller takes ownership is rate-limited against
whatever it last issued, including the forced-on restore of §4.3. So selecting
Amp after a long inert period follows the Apple TV immediately, while selecting
it seconds after leaving it waits out the interval first.

The forced-on restore of §4.3 and §4.4 is itself immediate, as stated there.

### 4.7 Logging

`console.log` on an issued command and on ownership changes, nothing else.
Never a toast, never a dashboard field, never Discord — the same silence
power-meters.md §1 requires of the guard. The amp following the TV is not news;
it is the appliance working.

## 5. The meter guard stands down

`meterRestoreActions()` takes a third argument: the set of entity ids currently
owned by the amp controller. Entities in that set are skipped.

Ownership is a module-level set exported by `lib/amp-power-control.ts`,
maintained by its own tick. It is:

- **empty** whenever the controller is inert — no config, the Amp category is
  not selected, or the source has gone stale (§4.4);
- **the configured switch ids** only while the Amp category is selected and the
  controller is actually managing the plug.

There is a third state, and it is the one that bit us live on 2026-09-19:
**started but not yet ticked**. Both loops begin at boot, and the guard's first
tick won the race — it read the plug `off`, restored power, and the controller
switched the amp off again a beat later:

```
[power-meter-guard] switch.tuya_mobile_floating_meter was off; restoring
[amp-power-control] holding the plug; the amp now follows media_player.home_theatre
[amp-power-control] Apple TV is off; switching the amp off
```

An on/off pair on every restart, inside an interval the guard does not observe.
So while `ampPowerControl` is configured and the controller has started but has
not completed a tick, the set reports the **configured** switch ids. That hold
lasts at most one `pollIntervalSeconds`; if the controller then turns out not to
own the plug, the guard restores it on its next 60-second pass — which is
exactly the delay §1 already tolerates.

So the guard's golden rule is untouched in every arrangement but the one
Adeline explicitly asked for, and it resumes within 60 seconds of the
controller letting go. The pure function keeps its own tests and gains one for
the exclusion; `lib/amp-power-control-ownership.test.ts` covers the boot race
the pure function cannot see.

The plug also stays in `homeAssistant.everythingExcludedEntityIds`: Home Off
and zone-off must still never reach it. The amp is switched by the Apple TV, by
the controller, and by nothing else.

## 6. Confirming a category change

Adeline, mid-build: *"put a confirmation modal on all category changes."*

Selecting any category in `FloatingMeterCard` now opens the shared
`ConfirmDialog` (`app/components/ConfirmDialog.tsx`) and applies nothing until
it is confirmed. One stage, not two.

- Title: `Move the floating meter?`
- Body names both ends and the consequence:
  `The meter is measuring <outgoing>. Moving it to <incoming> folds what it has
  learned into <outgoing> and starts measuring <incoming>. Only move it if you
  have physically moved the plug.`
- Confirm: `Move the meter`. Cancel: `Cancel`.
- Choosing the category that is already active does nothing and opens no
  dialog.

This exists because the category is **server state describing where a physical
plug is** (power-meters.md §3.2), not a preference. A mis-tap teaches the model
one group's draw against another group's name, and — now that §4 exists — a
mis-tap onto Amp hands the Apple TV authority over a plug that is feeding
something else. The dialog is cheap; the mistake is not. It is not optimistic:
the pending selection is only sent after confirmation, so a cancel leaves the
dropdown reading the truth.

## 7. The "Automate state" switch

Adeline, 2026-09-21: *"on the dashboard grid page, on the 'amp measured' power
usage amount, add a small checkbox under it and inset reading 'Automate state'.
if this is checked, it can use the current behaviour of turning on and off with
the apple tv. if it's unchecked, it will not respond to appletv events."*

**Where.** In `FloatingMeterCard`'s **amp row**, under that row's watts. It is
the compact checkbox the config surfaces already use to annotate a reading —
a visually-hidden input over an 18px box, under a 9px muted reading
(`.cyber-mini-checkbox` + `.rect-envelope-tag`, as `RangeSliderControlPanel`'s
`RandomTargetToggle` does). Not `CheckboxRow`, which is a full-width row for a
page of settings, and not a native `<input>` raw.

Only the amp row draws it, and only when `power.ampPowerControl` exists **and**
its `categoryId` is one of the floating meter's categories. Absent config means
no switch, like every other part of this feature.

**State, not config.** `data/power/state.json` → `ampPowerControl.{automationEnabled,
updatedAt}`, written by `POST /api/power/amp-automation { enabled }` inside the
power write queue (the meter tick rewrites the same file every few seconds, so
an unwritten read would be clobbered — the same reason §3.2's category takes the
queue). It sits beside `floatingMeter.activeCategoryId` because it is runtime
state that the loop reads on its next tick, not config, which arrives by deploy.

**Absent means on.** A state file written before this switch existed, or a
household that never touches it, keeps exactly the behaviour of §1–§6.

**The gate.** The switch is a second condition on §4.2's gate:

```
armed = categorySelected && automationEnabled
```

Off, the controller is inert in precisely the way another category being
selected makes it inert: no switching command of its own, ownership released,
and the plug handed back to the meter guard.

**Switching it off restores the plug**, on §4.3's terms: the controller is
putting down something it is no longer entitled to hold, so the restore is
immediate and counts as a switching command — an on/off pair is still spaced by
the interval. The consequence to expect, and it is the golden rule of
power-meters.md §1 rather than a defect: turning the switch off while the amp
was dark (Bluetooth headphones, §8) powers the amp **on**, because the plug is
only ever allowed off while this controller demonstrably owns it.

**The card is optimistic and takes the truth back.** It posts, holds the new
value until the panel's own 5-second poll reports it, and reverts on a failed
write — the same shape as §6's pending category.

## 8. The amp follows the audio output too

Adeline, 2026-09-21: *"when automated state is checked on, check the current
audio device of the apple tv. if it's 'TV Speakers' or similar, turn the amp on.
if it's anything else, turn the amp off. a common use-case is that I connect
bluetooth headphones."*

### 8.1 Where the value comes from

Not from any entity Home Assistant publishes today. HA's `apple_tv` integration
**receives** the Apple TV's output devices from pyatv and **drops them** —
`media_player.py`'s `outputdevices_update` handler is empty, and no attribute
carries it. §1's decision to read HA's entity rather than open a competing pyatv
session still stands, so the value is produced by a small HA-side component of
Nova's that reuses **HA's own** pyatv connection: `ops/homeassistant/nova_appletv_outputs`,
whose contract is [appletv-audio-outputs.md](appletv-audio-outputs.md). Nova
reads the entity id from `power.ampPowerControl.audioOutput.entityId`.

Absent `audioOutput` config means the condition does not exist: §1–§6 unchanged,
no entity read, no behaviour.

### 8.2 The decision

`lib/amp-inputs.ts`, beside `desiredFromSource()` so the loop itself only reads
values and compares them:

```ts
combinedAmpDesired(power, audio)
```

| Apple TV (power) | Audio output | Desired amp |
|---|---|---|
| asleep / `off` | anything | **off** — an off Apple TV draws nothing through the amp |
| awake | `onStates` (`"on"`) | **on** — playing through the TV's own speakers |
| awake | `offStates` (`"off"`) | **off** — the audio has gone to Bluetooth headphones, a HomePod, an AirPlay receiver |
| awake | unreadable | **on** — §1–§6's behaviour, which is the safe direction to be wrong in (§1.1) |

The states are config (`audioOutput.onStates` / `offStates`, defaulting to
`["on"]` / `["off"]`), so a bridge that reports names rather than a flag needs a
config edit, not a code change.

### 8.3 A dead bridge is never "off"

`unavailable`, `unknown`, a missing entity, or a state this household has not
classified is **no opinion**, never "off". A bridge that stops reporting must
not be able to silence the amplifier: the worst it can do is leave the amp
following the Apple TV's power state, exactly as it did before this section
existed.

That is a property of `desiredFromAudioOutput()`, not of the shipped config:
`unavailable`, `unknown` and the empty state are reserved, so listing one of
them in `audioOutput.offStates` does not make it mean off. A state both lists
name resolves to on.

### 8.4 The rate limit and the rest are unchanged

The audio output only changes *what* is desired. Every rule of §4 still holds:
one command per 30 seconds, level-triggered against what the plug actually
reads, releasing the plug when the category or the switch changes, and silence
in the UI (§4.7).

## Done means

- The Grid panel lists four categories, Amp among them, and moving the meter to
  Amp shows its live watts at `measured` confidence.
- "Amp" and "Sub + amp" appear under Amp in the panel and no longer under Home
  Entertainment.
- Changing the category opens a confirmation dialog; cancelling leaves the
  active category and the dropdown unchanged; confirming moves it.
- With Amp selected: the Apple TV going to sleep switches the amp off, and
  waking it switches the amp on.
- With Amp selected: two changes 5 seconds apart produce at most one switching
  command, and never two inside 30 seconds.
- With Amp selected: on→off→on inside 30 seconds produces **no** command.
- With any other category selected: the Apple TV changing state produces no
  command at all, and the plug switched off in HA is restored by the guard
  within 60 seconds.
- Moving the category away from Amp switches the plug on within 5 seconds, and
  moving it straight back does not switch the amp off until 30 seconds after
  that restore.
- `media_player.home_theatre` going `unavailable` produces no command; ten
  minutes of it switches the plug on and leaves it on.
- Restarting the dashboard with Amp selected and the Apple TV asleep leaves the
  amp off, with no on/off pair in the log.
- `npx vitest run` passes, including new tests for `decideAmpAction()`
  (rate limit boundary at 29/30 s, the coalescing cases, unavailable, the gate)
  and for the guard's exclusion set.

### The switch and the audio output (§7, §8)

- The amp row draws one small "Automate state" reading and checkbox under its
  watts, and no other row draws one; with no `ampPowerControl` config the card
  draws none at all.
- Ticking it posts `/api/power/amp-automation`; the new value shows at once and
  a failed write reverts to the server's.
- With the switch off, the Apple TV changing state issues **no** command, the
  plug returns to the guard on that tick, and the amp is left powered (the
  golden rule).
- With the switch on and `audioOutput` configured: an awake Apple TV playing
  through its own speakers powers the amp, and the same Apple TV routing audio
  elsewhere switches the amp off even though its power state never changed.
- The bridge's entity reading `unavailable` is no opinion: the amp follows the
  Apple TV's power state exactly as it did before §8 existed.
- `npx vitest run` passes, including `lib/amp-inputs.test.ts` (the audio table,
  the combined decision, absent config), the gate case in
  `lib/amp-power-control-ownership.test.ts`, and the switch cases in
  `FloatingMeterCard.test.tsx`.
