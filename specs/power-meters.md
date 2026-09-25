<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Metered power: Washing Machine and Floating Meter

Adeline, 2026-09-14. Plan codename `we-now-how-two-lazy-lemur`. Task log
`20260914T042058Z-5db7a382`. The attribution rules (then §4.5) and §4.6
power traces: plan codename `we-want-to-try-shimmering-sutton`, task log
`20260914T094859Z-f28f5fd9`, same day.

Two energy-monitoring smart plugs joined the LAN. They are the first real
measurements the power estimate has ever had — until now every watt in the Grid
panel came from `estimateDevice()` multiplying a rated wattage by brightness or
climate mode.

One plug is fixed to the **washing machine**. The other is the **floating
meter**: it moves between three groups of devices, measuring one at a time,
and each period it spends on a group teaches Nova what that group draws, so the
estimate for the other two keeps getting better.

| File | Holds |
|---|---|
| `lib/config-schema.ts` | `power.alwaysOnMeters`, `power.floatingMeter`, `power.washingMachine`, `dashboard.people` |
| `nova-household/dashboard-config.json` | this house's meters, categories, people, device ratings |
| `lib/power-meter-guard.ts` | the always-on guard loop |
| `lib/power-floating-meter.ts` | per-category accumulation and the learned model |
| `lib/washing-machine.ts` | cycle detection, the cycle store, attribution |
| `lib/power/wash-history.ts` | the wash graph's day blocks: the day, the index, one day's washes with their labels and curves |
| `lib/power.ts` | integration tick, base-load suppression, dashboard payload, MQTT publish |
| `app/api/power/floating-meter/route.ts` | set the active category |
| `app/api/power/washing-machine/route.ts` | attribute a cycle; read one day of the graph |
| `app/components/dashboard/PowerMeters.tsx` | both surfaces, mounted by `PowerPanel` |
| `instrumentation.ts` | starts the guard |

## Power estimation background

`lib/power.ts` estimates whole-house electricity usage and cost from Home
Assistant state — there is no household-wide meter. Data sources, in the
order they are preferred:

- Explicit power sensors, where available (the two metered plugs above are
  the only ones with `confidence: "measured"` today).
- Device wattage ratings (`power.deviceRatings`), combined with
  brightness/color state for lights and mode/temperature state for climate.
- Integrated local sample history.
- Optional Powershop account usage scrape files (§Powershop scrape below).
- Configured modeled base loads.
- Hardcoded Powershop rates for known 2025/2026 plans, unless overridden by
  data or config in future code.

State files: `data/power/state.json` (sample history and the floating-meter
categories of §3.3), `device-ratings.json` (`power.deviceRatings`), and
`account-usage.json` (Powershop scrape output).

Estimation behavior:

- Explicit power sensors override modeled estimates.
- Lights and illumination switches estimate standby/off and active watts;
  brightness scales the estimate, and color can apply an additional factor
  where modeled.
- Climate estimates cover standby/off, fan/dry, Gree heat/cool input watts,
  and a generic climate load based on temperature delta. Panel heater
  estimates reduce draw when the target appears satisfied.
- Modeled base loads include fridges, the water heater, the desktop PC, and
  Nova's own always-on load (`novaAioAverageWatts`) — the same base loads
  §3.4 suppresses when a floating-meter category measures them directly.

Integration behavior:

- Samples are serialized; elapsed hours since the previous sample are capped
  by `maxIntegrationHours`.
- Daily and hourly buckets are updated, and per-device kWh/cost accumulated.
- The billing cycle is a configured day-of-month start/end in
  `Pacific/Auckland`.

The dashboard payload includes the current rate, current watts, current cost
per hour, day/week/billing/year summaries, a billing projection, the account
usage and rate curves, a recent usage curve, background/base-load estimates,
top devices, and a rate-source warning when the rate fetch or hash
validation fails.

MQTT/Home Assistant publishing (general): the power monitor publishes MQTT
discovery and state through the HA `mqtt.publish` service, including
per-device estimated power/energy/rated power and home estimated power, at
configurable discovery/state intervals, retained. §6 below adds the two
meters' own sensors on the same path.

### Power UI

The Grid zone renders `PowerPanel`, which polls `/api/power` every 5 seconds
and on visibility/focus/online/pageshow, and toggles between credits/cost and
kWh display. It shows current use, daily estimate, billing estimate,
billing-to-date, curves, summaries, inferred base loads, and top devices, in
addition to the two meter surfaces described below.

## 1. The golden rule: neither meter is ever off

Adeline: *"neither of them must ever be switched off. If they are, power is to
be restored immediately. this should be a polling check every minute. don't
send me errors if they're down, just try to restore their power state."*

- `power.alwaysOnMeters: [{ id, label, switchEntityIds: string[] }]`. Only
  entities named here are guarded. Never lights, never anything else.
- One poll every **60 seconds**, started from `instrumentation.ts`.
- A guarded entity reading `off` gets `switch.turn_on` **immediately**, on that
  same tick. No dwell, no backoff, no attempt limit.
- `unavailable` and `unknown` are **not** `off`. The plug is off-network; a
  service call cannot reach it and would only log noise. Take no action.
- **Nothing is ever surfaced.** No toast, no dashboard warning, no Discord, no
  error field in the API payload. `console.log` on a state transition only, so
  the behaviour is auditable in container logs and nowhere else.
- A failed service call is swallowed. The next tick is 60 seconds away and
  retries on its own.

This is a **standing override** — exactly the thing `lib/lighting-convergence.ts`
refuses to be ("can never become a standing override of a change made from HA or
a wall switch"). That restraint is right for lights and wrong here: Adeline made
always-on a golden rule for these two plugs. The narrow config scope is what
keeps the two positions compatible; do not generalise this loop.

Both plugs also go into `homeAssistant.everythingExcludedEntityIds`, so Home Off
and zone-off can never switch them off in the first place — the same protection
the bedroom heater has.

## 2. Measurement into the grid

Two `power.deviceRatings` entries, each with `powerSensorEntityId` set and
`confidence: "measured"`. `estimateDevice()` (`lib/power.ts`) already prefers a
real meter over the model, so this is configuration, not new estimation code.

The meters do **not** appear as dashboard device tiles or zone controls. They
appear in Home Assistant, in the Grid panel's device list like any other rating,
and in the two dedicated surfaces below.

## 3. The floating meter

### 3.1 Config

```jsonc
"floatingMeter": {
  "powerSensorEntityId": "sensor.floating_meter_power",
  "entityIds": ["switch.floating_meter"],
  "minLearnedHours": 24,
  "categories": [
    { "id": "computers",          "label": "Computers",          "icon": "computers",
      "seedWatts": 200, "suppressesBaseLoads": ["nova_aio"],
      "members": ["Iridium", "Indium", "Ununhexium", "Desk lamp"] },
    { "id": "home_entertainment", "label": "Home Entertainment", "icon": "entertainment",
      "seedWatts": 120, "suppressesBaseLoads": [],
      "members": ["TP-Link switch", "WiFi extender", "Amp", "TV", "Security camera",
                  "Apple TV", "Sub + amp", "Nova kiosk"] },
    { "id": "kitchen",            "label": "Kitchen",            "icon": "kitchen",
      "seedWatts": 100, "suppressesBaseLoads": ["fridges"],
      "members": ["Fridge 1", "Fridge 2", "Main WiFi AP"] }
  ]
}
```

`icon` is one of a fixed set (`computers`, `entertainment`, `kitchen`) that the
panel maps to a glyph. Config never names a component.

Seed watts are first guesses, and they are deliberately short-lived — the point
of §3.3 is that measurement replaces them.

### 3.2 Active category

The active category is **server state**, not a user preference: it describes
where a physical plug is, and the estimator reads it on every sample. It lives
in `data/power/state.json` under `floatingMeter.activeCategoryId`, alongside
`activeSince`.

It starts at `home_entertainment` — where the meter is today.

Changing it closes the outgoing segment, folds that segment's observations into
the outgoing category's history, and opens a new one. Accuracy therefore
improves every time the meter is moved.

### 3.3 The learned model

Per category, `data/power/state.json` keeps:

```jsonc
"categories": {
  "<id>": {
    "kwhTotal": 0,
    "measuredSeconds": 0,
    "lastWatts": 0,
    "lastMeasuredAt": "<iso>",
    "hourly": { "2026-09-14T13": { "wattSeconds": 0, "seconds": 0 } }
  }
}
```

`hourly` buckets are raw observations: watt-seconds and seconds observed in that
dated hour while the category was being measured. Pruned to **90 days**, the
same discipline `pruneState` applies to the existing buckets.

The estimate for a category that is **not** currently measured is an
**hour-of-day profile** rebuilt on read from those buckets. For the current
hour-of-day `h`, modelled watts are the weighted mean of each bucket's mean
watts (`wattSeconds / seconds`) over the buckets whose hour is `h`, weighted by

```
bucketWeight = observedSeconds x recencyWeight(bucketDate, today, today)
```

`recencyWeight` and `similarityWeight` are **reused from
`lib/power-estimation.ts`**, exported rather than reimplemented: a 28-day
half-life, x2.5 for the same weekday, x1.25 for the same weekend-ness. A second
weighting scheme in the same codebase would be a defect.

Fallback ladder, and the confidence each step reports:

| Step | Condition | Watts | Confidence |
|---|---|---|---|
| 1 | Category is active | live sensor reading | `measured` |
| 2 | `measuredSeconds >= minLearnedHours` and this hour-of-day has buckets | weighted hour-of-day mean | `high` |
| 3 | `measuredSeconds >= minLearnedHours`, no bucket for this hour | flat weighted mean across all hours | `medium` |
| 4 | otherwise | `seedWatts` | `assumed` |

`minLearnedHours` is 24 by default: one full day on a group before its own data
outranks the guess.

### 3.4 Double counting *(decided)*

The categories overlap `power.modeledBaseLoads`, which already models fridges,
the water heater, a desktop PC and Nova's own draw. Counting both would inflate
the grid total, and the total would then jump every time the meter moved — the
exact opposite of what measuring is for.

So while a category contributes — measured **or** modelled, it contributes in
both states, which is why nothing changes when the meter moves — the base loads
it names in `suppressesBaseLoads` are withheld from `modeledCurrentBaseLoad()`
and from the modelled daily base:

- **Kitchen** suppresses `fridges`. The two fridges are the bulk of that group.
- **Computers** suppresses `nova_aio`. Iridium is Nova's host; its always-on
  draw is what `novaAioAverageWatts` models.
- **Home Entertainment** suppresses nothing. Nothing in that group — kiosk, TV,
  amps, network gear — is a modelled base load today. Since 2026-09-19 the amps
  are their own category; see [amp-appletv-power.md](amp-appletv-power.md),
  which also carries the one exception to §1 above — the always-on guard stands
  down on this plug while, and only while, that category is selected.
- The **water heater** and **desktop PC** are never suppressed. Neither is on a
  floating-meter group; Adeline's desk machine is not one of Iridium, Indium or
  Ununhexium.

## 4. The washing machine

### 4.1 Cycle detection

```jsonc
"washingMachine": {
  "powerSensorEntityId": "sensor.washing_machine_power",
  "entityIds": ["switch.washing_machine"],
  "startWatts": 15,
  "startSustainedSeconds": 120,
  "endWatts": 2,
  "endQuietSeconds": 180,
  "minCycleKwh": 0.05
}
```

Detection runs on the existing power sample tick, off the same HA state read.

**The three bands the plug actually reads.** Nine days of the fixed plug's own
history were read back on 2026-09-23, and they separate cleanly:

| reading | what the machine is doing |
|---|---|
| `0 W`, exactly | off: a finished load, and every minute until the next one |
| `4-5 W` | awake and paused: a soak, a drain, a lit panel |
| `15-700 W` | running: fill, tumble, spin |

`endWatts` sits *below* the pause floor and `startWatts` above it, and that is
what the two numbers are for: neither threshold then has to be defended by a
long window. The pair is a bet on the machine's own idle draw, and it is worth
naming: a machine that sits at 2 W or more with nothing running is in the dead
band, so no cycle of it could ever close — `endWatts` belongs above that draw and
below the wash's own pause floor, and on this plug the two are nine days apart
(0.0 W against 4.0 W). Two measured failures set them:

- **A soak is not an end.** Every mid-cycle pause in those nine days held
  4.0-4.9 W — seven of them inside a single wash, the longest 4.6 minutes. At
  `endWatts: 5` each of those was silence, and only `endQuietSeconds: 300` kept
  a wash from splitting in two; a pause of 5.5 minutes would have split it.
- **A few quiet minutes between loads is not one wash.** On 2026-09-23 one load
  stopped at 0 W and the next woke 3m48s later. Under 5 W / 300 s the two ran
  together as one 2h11m cycle, because the long window that protected the
  second load's fill pauses also swallowed the gap between them. At 2 W / 180 s
  the first load closes at its own drop and the second opens on its wake.
- `endQuietSeconds` stays longer than the wash's own timer's quiet
  (`timer.stopSeconds`): the timer is what finishes the wash and notifies about
  it, and the close is the storage edge that follows. A close window no longer
  than the timer's would tear the wash down — and its timer with it — on the
  same tick, before the wash was ever finished.
- A cycle **opens** when the meter has stayed above `startWatts` for
  `startSustainedSeconds`. The cycle's `startedAt` is **when the machine woke** —
  the first reading above the off floor — not when the drum's first sustained
  burst confirmed it: the fill's own pauses drop back under `startWatts`, so the
  wash was dated from the second burst — on 2026-09-23's morning the second load
  woke at 09:10:12 and was dated 09:15:30, 5m18s late. That wake is abandoned
  once the machine has spent longer below `startWatts` *in one pause* than the
  rise a wash itself takes — a fill that dips several times is still a fill — and
  a sample gap longer than the timer's limit abandons it too, since the wake
  belongs to a stretch nobody observed. Past either, the wash that follows is
  dated from its own drum.
  A wake is armed by the meter drawing above the off floor — the load starting,
  or the plug coming back after a stretch nobody observed — and never while the
  one before it stands, so a plug left drawing in the dead band cannot start a
  fresh wake every tick, and the count of time below `startWatts` begins with
  the pause rather than with the wake, so no wake inherits the count of the one
  before it.
- A cycle **closes** when the meter has stayed below `endWatts` for
  `endQuietSeconds`. `endedAt` is when it dropped, not when the quiet window
  expired.
- A closed cycle below `minCycleKwh` is **discarded** — that is the machine's
  standby panel or a door-open blip, not a wash.
- Energy is integrated the way `samplePowerUnlocked()` integrates everything
  else: `watts * elapsedHours / 1000`, with the same `maxIntegrationHours` gap
  guard. Cost is struck at the rate in force at the time of the sample, so a
  cycle spanning a tariff change is costed correctly.

### 4.2 The store

`data/power/washing-machine.json`, written with the same atomic
temp-file-then-rename as the power state:

```jsonc
{
  "version": 1,
  "open": { "startedAt": "<iso>", "kwh": 0, "costNzd": 0, "lastSampleAt": "<iso>",
            "aboveSince": "<iso>|null", "belowSince": "<iso>|null",
            "wokeAt": "<iso>|null", "belowStartSeconds": 0,
            "timer": { "startedAt": "<iso>", "endsAt": "<iso>", "extensions": 0,
                       "completedAt": "<iso>|null", "orbTimerId": "<uuid>|null" } },
  "cycles": [
    { "id": "<iso>-<short>", "startedAt": "<iso>", "endedAt": "<iso>",
      "kwh": 0.62, "costNzd": 0.18, "person": "addie" }
  ]
}
```

`cycles` is pruned to **400 days** — enough for a year-on-year comparison.

This is deliberately **not** a `DashboardPreferences` sub-object. Preferences
are user settings, they are diffed into minute-bucket undo history, and every
nested object there needs a hand-written merge branch or it silently erases its
siblings. Cycles are observations; they belong in their own store, next to the
power state they come from.

### 4.3 Attribution

People come from household config, never product source —
`lib/no-household-data.test.ts` forbids household data in the shipped tree:

```jsonc
"dashboard": {
  "people": [
    { "id": "addie", "label": "Addie", "color": "#22d3ee" },
    { "id": "tonya", "label": "Tonya", "color": "#e879f9" }
  ]
}
```

- Tapping a cycle block cycles its `person`: **Unassigned -> Addie -> Tonya ->
  Unassigned**, following config order. A block whose attribution is a *default*
  (§ below) is treated as Unassigned by a tap, so one tap claims it for the first
  configured person rather than walking through the person the default picked.
  Optimistic in the UI, no modal, no confirm — a mis-tap is fixed by tapping
  again.
- Sub-totals are shown for each configured person plus Unassigned, in both kWh
  and cost, following the panel's existing credits/kWh `displayMode` toggle.
- With no people configured, the attribution UI is absent and only the monthly
  total renders. The product stays generic.

A tap records `attribution: { source: "manual", at }` on the cycle. The
unclaimed default (§4.5) never overrides one.

A wash nobody **claims** belongs to the household's other person:
`power.washingMachine.unclaimedPersonId` (for this household, Tonya). Nobody
claimed it, so it is not evidence about the primary person, and the rule-based
guess that used to fill that gap is gone. The default is applied at the
**close**, when the wash has actually finished, with `attribution: { source:
"auto" }` — a default is not a tap, and the block is hatched for it. With no such
person configured the wash closes **Unassigned**, which is what a household of
one wants.

It is deliberately **not** applied to a running wash. The completion edge is a
*pause* — a soak or a drain longer than the stop window — not an end, so a wash
whose machine is still going is nobody's to reassign. Reassigning one there made
a panel the household was watching change hands by itself, and the tap it invited
cycled on from an attribution nobody had made, landing on the wrong person.

### 4.4 The month

**Calendar month**, `Pacific/Auckland` — 1st to end of month. Not the Powershop
billing cycle the rest of the panel uses. A shared cost is split by the month
people actually live in.

### 4.5 The wash's timer

The wash's notification is the household's **one** timer, driven by the machine.
Adeline, 2026-09-23: *"I guess it's like a user timer but it's not… if I claim
it, begin a timer with the estimated remaining time. the first period for this is
1 hr 10 minutes… at the end of the timer, if the washing machine is still drawing
power to do a wash, extend the timer by 10 minutes… if the washing machine stops
drawing power for 2 minutes (or is so low that it's probably just alerting)
finish the timer and play the timer notification sound."*

- A wash **starts** the timer when it is **claimed**: the tap on the running wash
  block that attributes it to the **primary** person. An unclaimed wash starts
  nothing and is notified by nothing.
- The timer's **first period** is `timer.firstPeriodMinutes`, measured from the
  claim.
- When a period ends with the machine **still drawing power to do a wash** — above
  `timer.stopWatts` — the timer is extended by `timer.extendMinutes`, and so on
  until the machine stops. A period whose end is more than one extension in the
  past (the app was down, the meter was unreachable) is anchored to the present
  rather than replayed: nobody was watching those periods.
- The timer **finishes** once the meter has read at or below `timer.stopWatts` for
  longer than `timer.stopSeconds` of observed sample time — the same window, and
  the same moment, the completion record is captured at, so the chime and the
  notification describe one event.
- `timer.stopWatts` is the same floor as §4.1's `endWatts`, and for the same
  reason: a wash's own soak and drain pauses read 4-5 W for minutes at a time, so
  a timer threshold above them reads a machine that is still running a wash as
  stopped, and finishes it — the false "done" this rule exists to remove. Both
  thresholds sit under the pause floor, at the zero a finished load actually
  reads.
- Nothing but the machine ends it. The household timer it drives is published as a
  **driver-completed** timer (`autoComplete: false`), so no screen can flash
  "Done" or chime at the end of a period while the wash is still running.
- Everything else about it is the household timer's own machinery, unchanged: the
  countdown ring, the chime, the 30 s repeat, the orb flash, the tap that
  dismisses it on every screen and its Discord message.
- The icon and label are the household's **first configured timer icon** (for
  Adeline, a t-shirt glyph labelled "Wash clothes"); a household that has
  configured none gets the default `Countdown` icon — the same fallback the timer
  control uses.
- It is the household's single timer, so a claim **replaces** a countdown already
  running. If the household replaces it with a timer of their own mid-wash, the
  wash stops driving it and never takes it back; the wash's own countdown then
  continues on the orb's washing entry alone.
- A tap that takes the wash off the primary person (**unclaiming**) releases an
  unfinished timer silently. One that has already finished is left alone: it is
  an alert waiting to be acknowledged, and the wash ending is not an
  acknowledgement.
- A wash whose `completion` has already been captured — or whose own timer has
  already completed — starts no timer: between that edge and the cycle closing
  (§4.1's `endQuietSeconds`) the finished wash is still tappable, and a countdown
  for a wash that is done must not replace the alert standing on the household's
  screen.

The open cycle carries the wash's own timer —
`{ startedAt, endsAt, extensions, completedAt, orbTimerId }` — and the household
timer is a mirror of it. `orbTimerId` is what makes the wash the owner of that one
timer and of nobody else's: a tick extends, finishes or releases only the timer it
set.

Config, household data only (`nova-household/dashboard-config.json`):

```jsonc
"washingMachine": {
  "unclaimedPersonId": "tonya",
  "timer": {
    "firstPeriodMinutes": 70,
    "extendMinutes": 10,
    "stopWatts": 2,
    "stopSeconds": 120,
    "maxSampleGapSeconds": 90
  }
}
```

**If the meter never reports again** the timer waits where it is, showing `0:00`
on the orb: nothing has told it the machine stopped, and a timer that guessed
would be the false "done" this rule exists to remove. The household can cancel it
from the set-timer control, or set a timer of their own.

**What this replaced.** Until 2026-09-23 an unclaimed wash was *guessed* at from
its duration and the gap since the primary person's last wash (`autoAttribution`:
`day-gap`, `consecutive`, `spin`), and a fixed `typicalMinutes` (66) ETA on the
orb's washing entry stood in for a timer. Both are gone: the claim is the signal
(§4.3's unclaimed person is what a wash nobody claimed becomes), and the countdown
is this timer's, on the timer entry and on the washing entry alike.

### 4.6 Power traces

Every wash keeps its own power curve, so the re-review has real shapes to learn
from rather than totals.

- Each sample tick while a cycle is open appends `[offsetSeconds, watts]`
  (offset from `startedAt`, whole seconds; watts to one decimal) to
  `data/power/washing-machine-traces/open.json`, a sidecar so the main store is
  not rewritten with a growing array each tick. Samples taken while the rise
  was being confirmed are kept from the cycle's own start — `wokeAt` until it
  is confirmed, `startedAt` after — so the curve begins where the cycle does.
  The sidecar carries the open cycle's `startedAt`; one that does not match the
  open cycle is discarded.
- At close, the trace is written to
  `data/power/washing-machine-traces/<cycleId>.json`:

  ```jsonc
  { "cycleId": "…", "person": "addie", "attribution": { "source": "manual", "at": "…" },
    "startedAt": "…", "endedAt": "…", "kwh": 0.62, "points": [[0, 212.4], [30, 380.0]] }
  ```

  A cycle discarded under `minCycleKwh` writes no trace.
- Every attribution change — a tap, or the unclaimed default — rewrites the
  trace file's `person` and `attribution`, so the curve is always logged against
  the current person.
- Trace files are pruned with their cycles (400 days).
- Traces are recorded for every wash, assigned or not, so a later tap still has
  a curve.
- The dashboard payload carries each cycle's curve downsampled to at most **48
  points** (`curve: number[]`, watts evenly spaced across the cycle), and the
  same for the running wash. The full trace stays on disk.

## 5. UI

Both surfaces sit in the **main (left) column** of `PowerPanel`, above the
Account usage curve, as one `power-meter-grid` row that stacks to one column at
kiosk portrait width. They live in their own file, `PowerMeters.tsx`, mounted by
one line in `PowerPanel` — the panel itself is under concurrent edit for the
main/advanced split, so this feature keeps its footprint there to a mount.
Styles go in `app/styles/dashboard/power.css` beside the existing `.power-*`
rules.

### 5.1 Floating Meter

- Title, the live watts, and the category **dropdown**: `ConfigSelect`, which
  already takes a per-option `icon` — no new picker, no native `<select>`.
- Under it, one compact row per category: icon, label, watts, and a confidence
  dot coloured by the ladder in §3.3 (measured / high / medium / assumed). The
  active category's row is marked live.

### 5.2 Washing Machine

- Header: title on the left, the calendar-month total on the right in the
  panel's current display mode (the live watts instead, while a wash is running).
- Above the graph, the day on show labels itself in the panel's small uppercase
  with **its own local date**, and a step button sits outside each end of that
  row. The visible range's own start and end times are deliberately **not**
  drawn: the axis runs midnight to midnight, and the times worth reading on it
  are each wash's own.
- The graph shows **one local day at a time**, hand-rolled SVG in the house
  style of `CurveChart` — this repo has no chart library and is not getting one.
  A day is midnight to midnight in `power.timeZone`. Each wash in it is a block
  placed by its own clock times across the day's width, its height proportional
  to its kWh against that day's largest wash, its fill the assigned person's
  colour (neutral when unassigned). Blocks are buttons, with a minimum touch
  width, and a wash that runs over midnight (11:50 PM–12:40 AM) is drawn clipped
  in both the days it touches.
- **Under each block, that wash's own start time and duration** (`2:05 PM ·
  1h 22m`), labelled by the server in the household's timezone like the date
  above it, so a wash running over midnight reads the same in both days. A label
  is centred under its block and kept inside the graph's edges; a label that
  would draw over the one before it takes the next row down (two loads an hour
  apart is ordinary here), and the graph reserves a row for each it needs.
- The step buttons move to the previous and next day **that holds a wash**: the
  index is built from the washes themselves, so a day the household did not wash
  in is never landed on, and the newest such day is what the graph shows by
  default. It re-reads itself every 10s (`useWashHistory`), so a wash starting
  or running comes forward on its own at the meter tick's pace (§7.3), while a
  day stepped back to is read once and stays where it was put.
- Under the graph, the sub-totals: Addie, Tonya, Unassigned. These stay the
  **calendar month's** (§4.4), as does the header, whichever day is on show.
- Each block draws its own watts curve (§4.6) inside it, across the block's
  width, scaled to that wash's own peak. SVG line, no chart library.
- An **auto-attributed** block (§4.5) has the person's colour as a **hatched**
  fill; a manual block is solid; Unassigned stays neutral. A tap cycles the
  person as before and makes the attribution manual — on any wash the store still
  holds, 400 days of them (§4.2), not only this month's.
- The graph's own data is `GET /api/power/washing-machine`: without `?block` the
  newest day holding a wash, with it (`<epoch ms>`) that day. The reply is the
  day index, the day on show with its date, and each of its washes with its own
  start/duration labels and its curve read from its trace file (§4.6). It is
  deliberately **not** part of the polled `/api/power` payload, whose
  `washingMachine.cycles` stay this month's for the sub-totals: a year of washes
  with curves on every 5s poll would be carried for nothing.
- The old rolling twelve-hour x-axis, and the square-root time compaction that
  went with it, are gone: a wash is placed linearly, at its own clock time.

## 6. Published back to Home Assistant

Through the existing `publishDiscovery()` / `publishPowerState()` MQTT path, on
the `Nova Grid` device:

| Sensor | Class |
|---|---|
| `nova_power_washing_machine_month_kwh` | energy, `total` |
| `nova_power_washing_machine_month_<personId>_kwh` (one per configured person) | energy, `total` |
| `nova_power_washing_machine_month_unassigned_kwh` | energy, `total` |
| `nova_power_floating_meter_category` | diagnostic text, the active category's label |
| `nova_power_floating_<categoryId>_estimated_power` (one per category) | power, `measurement` |

The two plugs' own power/energy sensors come from their integration and need no
republishing.

## Done means

### Claimed-wash completion alerts

An optional `power.washingMachine.completionAlert` household setting names the eligible
person, Discord delivery and drying thresholds. There are no config-page controls. The
zero-power threshold, the quiet duration and the report freshness limit are no longer
its: §4.5's stop rule is what "the machine has stopped" means, for the timer and for this
record alike.

It names no sound. The wash sounds nothing of its own: its notification is an ordinary
household timer, started by the claim ("The wash's timer" below), so the chime, the orb
flash and the tap that dismisses it are the timer's — the same proven path every other
countdown uses. The uploaded MP3, the washing-machine audio and chime routes and the
`Audio` element that played it are gone; the clip left in `data/household-audio` is not
read by anything.

Claiming the live graph's wash creates a session-linked temporary reminder. It waits
silently until a confirmed wash exceeding `minCycleKwh` has been quiet — at or below
§4.5's `stopWatts` — for strictly more than its `stopSeconds`.

That window is measured in **observed sample time** — the meter tick's own clock,
the same one §4.1's close timer uses. It has to be: the plugs report **on change**,
so once the machine settles at zero the integration stops writing the entity and
`last_reported` freezes at the instant of the drop and never moves again
(`homeassistant.update_entity` does not move it either — §7.2's cloud refresh is
not a heartbeat, measured 2026-09-22 with both plugs 26 and 43 minutes stale). A
window measured from a timestamp that never advances can never elapse, and the
first live wash under this rule — a claimed 56-minute wash that finished at
`2026-09-22T02:31:29Z` — was observed ending at 0 W by every metre tick and
alerted nobody; the same wash replays to a completion 61 s after the drop under
the rule below.

A report fresh enough to trust says *when* the drop happened and anchors the
window there. One already older than `maxSampleGapSeconds` cannot anchor it — that
would backdate the window to a moment nobody was watching — but it is not grounds
for discarding the window either: the value it carries is still the meter's last
word. Such a window starts with the sample that observed it, so a cached zero can
never complete a wash on the first tick after a restart. A reading above
`stopWatts`, a sample gap beyond `maxSampleGapSeconds`, or no reading at all
resets the window.

Completion ownership is captured at the edge, so historical
attribution cannot create alerts. Acknowledging removes the temporary icon; the task
record retains acknowledgement to prevent replay. Active and historical claim writes
share the power sampler's write queue.

The completion flashes the icon — it sounds nothing itself, the timer the claim
started is what chimes (§4.5) — and emits the existing `reminder.due` event with the
completion text and `discord-bot.onDue` enabled on that event. No device-specific Discord
hook or module update is needed. The stored reminder's ordinary echo stays disabled so only the
enriched completion notification is announced. The Discord module queues one combined
completion/drying message, deduplicated by wash ID and original completion time. Its
generic reminder echo is disabled. The hourly HA forecast is assessed against the
household's rain/daylight thresholds; missing coverage yields an explicit No with an
unknown-forecast reason. Forecast results are captured once, not recomputed on retries.


- Switching either meter off in Home Assistant restores it within 60 seconds,
  and nothing about it reaches the dashboard, a toast, or Discord.
- `unavailable` provokes no service call.
- Both meters appear in the Grid device list with `measured` confidence, and
  their watts track the plug rather than a model.
- Neither meter appears as a zone control, and Home Off cannot switch them off.
- The floating-meter dropdown changes category, the outgoing segment is folded
  into that category's history, and its modelled contribution afterwards
  reflects what was measured.
- A category with no history reports `assumed` and its seed watts; after a day
  of measurement it reports `high` and its own hour-of-day profile.
- The grid total does not jump when the meter moves between categories.
- A wash produces exactly one cycle block; a short standby blip produces none;
  a pause mid-wash does not split it, and two loads a few minutes apart produce
  two blocks rather than one long one.
- Tapping a block cycles Unassigned -> Addie -> Tonya -> Unassigned and the
  sub-totals follow.
- The month total is the calendar month in `Pacific/Auckland`.
- Both surfaces render without overflow at kiosk portrait and landscape.
- `npx vitest run` passes, including new tests for the guard decision, the
  fallback ladder, and the cycle-detection boundaries.

### The wash's timer and traces

- Period boundaries are tested: a period that runs out with the machine still
  drawing extends by `extendMinutes` and counts the extension; a period that runs
  out with the machine quiet does not; a stalled period anchors to the present.
- A timer that has finished is never extended, and its finish time is recorded
  once.
- A claimed wash's timer is started for `firstPeriodMinutes` from the claim, and
  is published to the household timer as `autoComplete: false`.
- The meter tick extends the running timer while the machine draws, and finishes
  it at the machine's quiet — before the period it was counting would have run
  out.
- A tap that takes the wash off the primary person releases an unfinished timer
  silently; a timer that has already finished is left for the household to
  acknowledge.
- A wash whose `completion` has already been captured, or whose own timer has
  already completed, starts no timer.
- An unclaimed wash closes as `unclaimedPersonId` with `attribution.source` of
  `auto`, and its completion (when there is one) is announced to nobody. With no
  unclaimed person configured it closes Unassigned.
- A claimed wash is never re-assigned by the unclaimed default, and its
  completion is announced when the alert person claimed it.
- A closed wash has a trace file whose `person` follows a later tap.
- Blocks show their curve and auto blocks are hatched, without overflow at
  kiosk portrait and landscape.

## Status orb wash entry

See [status-orb-stack.md](status-orb-stack.md). Exactly one household person is
primary; the wash's timer is that person's claim (§4.5). A configured washing orb
entry counts down the wash's timer — the same periods the timer entry shows — and
suppresses the temporary wash icon; the entry flashes on completion and is
acknowledged by a tap, and it never chimes — the timer the claim started is what
sounds. Without the entry, keep the temporary icon, which is likewise silent, and
the timer entry carries the countdown alone. Discord completion behaviour is
unchanged.

## 7. Round 2: polling, cycle floor and data repair (Adeline, 2026-09-15)

Plan `we-ve-separated-the-landscape-s-ancient-parnas` round 2, task log
`20260914T101019Z-06c0031b`.

### 7.1 What the plugs actually report (measured 2026-09-15)

- The plugs are Arlec Grid Connect (Tuya `cz`) energy sockets, reaching HA only
  through the cloud bridge (`sensor.tuya_mobile_*_power`). The bridge reports on
  change: about every **45 s** while the washing machine was running, about
  **hourly** when the floating meter's load was steady. No energy (kWh) counter
  entity is exposed.
- Tuya sockets measure power internally every ~2 s; the Smart Life app gets
  ~2 s updates only while it is actively refreshing. Local polling over the LAN
  (`tuya_local`, protocol DPs 18–20 current/power/voltage, 17 energy increment)
  can read at any cadence.
- The morning wash of 2026-09-15 (20:06:56Z–20:39:30Z, 11–142 W) integrated to
  about 0.04 kWh and was **discarded** under `minCycleKwh: 0.05`.

### 7.2 Polling ladder

1. **Local, 10 s.** If both plugs answer on the LAN from Iridium, they are added
   to HA's `tuya_local` with a 10 s poll of power (and the energy DP where the
   device exposes it). Nova reads the local entities in preference to the cloud
   twins (`powerSensorEntityId` points at the local sensor; the cloud twin stays
   as a fallback when the local one is `unavailable`).
2. **Cloud refresh, 30 s.** If the LAN is blocked (AP isolation), Nova calls
   `homeassistant.update_entity` on each plug's cloud power entity every 30 s.
   If the bridge ignores that, record it and keep the report-on-change stream.
   **It ignores it** (measured 2026-09-22: both plugs' `last_reported` sat 26 and
   43 minutes behind, at their last *change*), so nothing may treat that
   timestamp as a heartbeat — see the completion alert, which had to stop
   measuring its quiet window against it.
- Whichever applies is household config: `power.meterPolling:
  { intervalMs, refreshEntityIds[] }`. Product code names no entity.

### 7.3 The meter tick

- A dedicated **10 s** meter tick (`power.timing.meterSampleIntervalMs`, default
  10000) reads only the meter entities (washing machine and floating meter) and
  runs cycle detection, completion, traces and floating-meter accumulation. The
  30 s grid sample no longer does meter work. Both share the power write queue.
- Energy between readings is the previous reading held (zero-order hold) over
  the elapsed time, under `maxIntegrationHours`. If an energy counter entity is
  configured (`energySensorEntityId`), cycle and category energy come from the
  counter's delta instead, and power only drives detection.
- Wash traces record at the tick (whole-second offsets), so detection and
  attribution rules stay resolvable to the minute.

### 7.4 Cycle floor

- Household `minCycleKwh` becomes **0.02** — a cold wash draws little.

### 7.5 Data repair operations (generic)

Both run inside the power write queue, back up the store they change
(`<file>.bak-<timestamp>`), and are exposed as POST routes that take their
parameters in the body; no household value lives in code.

- `POST /api/power/floating-meter/reattribute { fromCategoryId, toCategoryId,
  until }` moves every hourly bucket (and its share of `kwhTotal` and
  `measuredSeconds`) whose hour **starts** before `until` from one category to
  the other, merging buckets that already exist. A partial hour moves whole: the
  source category was not being measured after `until`, so everything in that
  bucket belongs to the destination.
- `POST /api/power/washing-machine/rebuild { from, to }` reads the meter's HA
  history for that window, replays it through cycle detection with the current
  config, and inserts any cycle not already stored (matched by overlapping time),
  with its trace. Existing cycles and their attribution are untouched.

Run once on live (2026-09-15): reattribute `computers` → `home_entertainment`
until `2026-09-15T00:17:29Z`; rebuild `2026-09-14T00:00Z`–now; set the
rebuilt 2026-09-14T20:06Z wash to Tonya (manual); the 05:04Z wash stays Addie.

### 7.6 Tapping a wash block

- No focus ring or focus box on a block after a tap; the tap cycles the person
  and the block's colour changes immediately (optimistic). Keyboard focus is
  still shown for keyboard users only (`:focus-visible`).

### Done means (round 2)

- HA history for both plugs shows ≤10 s (local) or ≤30 s (cloud) spacing.
- A short, low-power test load is detected as a cycle with a trace.
- Power panel shows two washes: Addie (yesterday 17:04) and Tonya (this morning
  08:07), and Home Entertainment's history reaches back to 2026-09-14T17.
- Reattribute and rebuild are covered by unit tests, including idempotence.

## Powershop scrape

`scripts/powershop-daily-scrape.mjs` uses Playwright to log into Powershop,
capture usage data, normalize it, and write daily JSON records — the account
usage data source §Power estimation background lists above.

- Credentials: `POWERSHOP_EMAIL` / `POWERSHOP_PASSWORD`.
- Supports dry-run, target date, `--storage-state`, template path, data
  directory, and headful/headless options. `--fresh-login` ignores the saved
  state for one run but replaces it only after a successful login, so a
  failed refresh leaves the working state recoverable.
- `--start-date YYYY-MM-DD --end-date YYYY-MM-DD` refreshes an inclusive
  range in one authenticated session via the direct hourly-measurements API,
  retains separate raw evidence and daily output per date, pauses briefly
  between requests, continues past isolated failures, and updates
  `latest.json` only after the end date completes.
- MFA challenge pages are not treated as authenticated dashboard sessions; a
  successful dashboard check refreshes the saved Playwright storage state at
  `storage-state.json` in the Powershop data directory. Login codes come via
  `--login-code`, `POWERSHOP_LOGIN_CODE`, or `--wait-for-login-code` in the
  same session; the Docker wrapper's file-based form
  (`--wait-for-login-code --login-code-file /data/login-code.txt`) lets an
  operator write the temporary code into the host data directory without a
  second login session. Code files are consumed and removed as soon as they
  are read; storage state is written atomically with mode `0600`, and an
  unusable state is ignored so the process falls through to login instead of
  dying before the MFA wait.
- A durable manual refresh keeps the original browser request open while an
  operator (or a Gmail-connected agent) retrieves the fresh six-digit code:
  `bash scripts/run-powershop-daily-scrape.sh --fresh-login --login-only
  --wait-for-login-code --login-code-file /data/login-code.txt`. Write the
  code atomically to `data/power/powershop/login-code.txt` (mode-`0600`
  sibling temp file, then rename); the old saved session is untouched until
  the replacement authenticates.
- After authentication, the scraper calls Powershop's authenticated
  `measurements` GraphQL query directly for hourly consumption records,
  deriving kWh from `value` and cost from `CONSUMPTION_COST` plus
  `STANDING_CHARGE_COST` `costInclTax.estimatedAmount`, and keeps the older
  page/network scrape as fallback evidence. Account/property discovery
  accepts the current `accountsList`/`account` bootstrap responses as well as
  the older `accountViewer` response.
- Failed runs are retained under `failures/` with their error text, rather
  than leaving only an opaque status line in the cron log.
- `scripts/run-powershop-daily-scrape.sh` runs the scraper in a Playwright
  Docker image matching the checked-in Playwright 1.60 dependency, host
  networking, logs in the data directory, `flock` serialization, and passes
  only `POWERSHOP_*` values into the browser container rather than exposing
  the dashboard's unrelated secrets.
- `scripts/install-powershop-cron.sh` installs a cron entry at `8 5 * * *`
  for the runner under `/opt/nova-ha-dashboard` by default.

## GymMaster attendance scrape

`scripts/gymmaster-attendance-scrape.mjs` uses Playwright to log into the
AllFit GymMaster member portal and open `/portal/account/visithistory`.

- Credentials (`GYMMASTER_EMAIL` / `GYMMASTER_PASSWORD`) live in the runtime
  environment or Nova `.env.local`, never in source.
- The scraper reuses a Playwright storage state file under the GymMaster data
  directory after successful login, extracts candidate visit timestamps from
  the visit-history DOM and captured portal responses, chooses the newest
  non-future visit, and writes `data/gymmaster/latest.json`.
- On success it updates `/api/watchface` with `gymLastResetAt: <latest visit
  ISO timestamp>` so the avatar and watchface share the same counter source;
  if the API is unreachable it falls back to updating the dashboard
  preferences file directly.
- It writes only compact status/evidence metadata and the selected
  timestamp — never the GymMaster password or raw portal HTML.
- `scripts/run-gymmaster-attendance-scrape.sh` runs it in a Playwright Docker
  image with host networking, a non-overlap lock, mounted dashboard data, and
  logs under `data/gymmaster/logs`.
- `scripts/install-gymmaster-cron.sh` installs the cadence: every 15 minutes
  from 20:00 through 02:00, once per hour from 03:00 through 19:00, in the
  Nova host's local timezone.
