# Metered power: Washing Machine and Floating Meter

Adeline, 2026-09-14. Plan codename `we-now-how-two-lazy-lemur`. Task log
`20260914T042058Z-5db7a382`.

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
| `lib/power.ts` | integration tick, base-load suppression, dashboard payload, MQTT publish |
| `app/api/power/floating-meter/route.ts` | set the active category |
| `app/api/power/washing-machine/route.ts` | attribute a cycle |
| `app/components/dashboard/PowerMeters.tsx` | both surfaces, mounted by `PowerPanel` |
| `instrumentation.ts` | starts the guard |

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
  amps, network gear — is a modelled base load today.
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
  "endWatts": 5,
  "endQuietSeconds": 300,
  "minCycleKwh": 0.05
}
```

Detection runs on the existing power sample tick, off the same HA state read.

- A cycle **opens** when the meter has stayed above `startWatts` for
  `startSustainedSeconds`. The cycle's `startedAt` is when the rise began, not
  when it was confirmed.
- A cycle **closes** when the meter has stayed below `endWatts` for
  `endQuietSeconds`. `endedAt` is when it dropped, not when the quiet window
  expired. Five minutes of quiet means a mid-cycle soak or drain pause never
  splits one wash into two.
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
            "aboveSince": "<iso>|null", "belowSince": "<iso>|null" },
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
  Unassigned**, following config order. Optimistic in the UI, no modal, no
  confirm — a mis-tap is fixed by tapping again.
- Sub-totals are shown for each configured person plus Unassigned, in both kWh
  and cost, following the panel's existing credits/kWh `displayMode` toggle.
- With no people configured, the attribution UI is absent and only the monthly
  total renders. The product stays generic.

### 4.4 The month

**Calendar month**, `Pacific/Auckland` — 1st to end of month. Not the Powershop
billing cycle the rest of the panel uses. A shared cost is split by the month
people actually live in.

## 5. UI

Both surfaces sit in the **main (left) column** of `PowerPanel`, above the
Account usage curve, as one `power-meter-grid` row that stacks to one column at
kiosk portrait width. They live in their own file, `PowerMeters.tsx`, mounted by
one line in `PowerPanel` — the panel itself is under concurrent edit for the
main/advanced split, so this feature keeps its footprint there to a mount.
Styles go in `app/globals.css` beside the existing `.power-*` rules.

### 5.1 Floating Meter

- Title, the live watts, and the category **dropdown**: `ConfigSelect`, which
  already takes a per-option `icon` — no new picker, no native `<select>`.
- Under it, one compact row per category: icon, label, watts, and a confidence
  dot coloured by the ladder in §3.3 (measured / high / medium / assumed). The
  active category's row is marked live.

### 5.2 Washing Machine

- Header: title on the left, the calendar-month total on the right in the
  panel's current display mode.
- A small month graph, hand-rolled SVG in the house style of `CurveChart` —
  this repo has no chart library and is not getting one. The x axis is the days
  of the current month; each detected cycle is a block positioned on its day,
  its height proportional to its kWh against the month's largest cycle, its fill
  the assigned person's colour (neutral when unassigned). Blocks are buttons,
  with a minimum touch width.
- Under the graph, the sub-totals: Addie, Tonya, Unassigned.

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
person, MP3 file, zero-power threshold, quiet duration, report freshness limit, Discord
delivery and drying thresholds. There are no config-page controls. Audio is stored in
`data/household-audio` (or `NOVA_HOUSEHOLD_AUDIO_DIR`) and served by the washing-machine
audio route; deployment preserves it.

Claiming the live graph's wash creates a session-linked temporary reminder. It waits
silently until a confirmed wash exceeding `minCycleKwh` has fresh zero-power reports
spanning strictly more than the configured quiet duration. Missing reports and sampling
gaps reset that timer. Completion ownership is captured at the edge, so historical
attribution cannot create alerts. Acknowledging removes the temporary icon; the task
record retains acknowledgement to prevent replay. Active and historical claim writes
share the power sampler's write queue.

The completion activates the icon, plays its entire custom sound once across web
screens, and emits `washing-machine.completed`. The Discord module queues one combined
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
  a pause mid-wash does not split it.
- Tapping a block cycles Unassigned -> Addie -> Tonya -> Unassigned and the
  sub-totals follow.
- The month total is the calendar month in `Pacific/Auckland`.
- Both surfaces render without overflow at kiosk portrait and landscape.
- `npx vitest run` passes, including new tests for the guard decision, the
  fallback ladder, and the cycle-detection boundaries.
