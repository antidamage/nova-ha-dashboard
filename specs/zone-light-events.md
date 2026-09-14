# Zone light events

Adeline, 2026-09-14. Plan `we-have-a-concept-unified-lamport`, task log
`20260914T040659Z-182a2a14`.

Timed colour and brightness changes for a lighting zone. They join the two
policies already in `dashboard.lighting` — the neon intensity threshold and the
conservatory pinned preset — rather than replacing them.

| File | Holds |
|---|---|
| `lib/config-schema.ts`, `lib/types.ts` | the rule schema |
| `lib/light-events.ts` | when a rule is due, and what it sends |
| `lib/dashboard-events.ts` | the host poller that fires them (`scanAdaptiveLighting`) |
| `lib/ha.ts` | the turn-on path that consumes a staged value |
| `app/api/lighting/zone-events/route.ts` | list and edit |

## They live and run on the host

The rules are host state. They sit in the shared dashboard config under
`dashboard.lighting.zoneEvents`, and the host's poller fires them — the same
60s pass that already runs adaptive candlelight, intensity thresholds and
pinned presets. **A client never schedules anything.** A dashboard is a way to
read and edit the list; with every dashboard closed, the rules still fire.

## A rule

Targets a **zone** (or subzone) — the same zones the dashboard shows.

| Field | Meaning |
|---|---|
| `id` | stable id |
| `zoneId` | the zone it drives |
| `name` | optional label |
| `enabled` | off without deleting |
| `at` | `{ kind: "clock", hhmm: "07:30" }` or `{ kind: "sun", event: "sunrise" \| "sunset", offsetMinutes: -30 }` |
| `days` | weekdays it may fire on; empty means every day |
| `value` | `{ hue, saturation, brightness }` from a `ZoneColorEncoder` dial |

**Times of day only — there are no ranges.** A rule is a single event: it
fires, it sets the lights, and it is done. Anything done afterwards, by hand
or by another rule, simply wins. Nothing is held or restored.

## Brightness is the on/off axis

- `brightness = 0` means off. A rule with zero brightness switches the zone's
  lights off.
- Any brightness above zero means on, at that value.

That is what lets the same rule drive the switched neon lights, which have no
colour and no dimming — they follow the same zero-is-off reading the rest of
the lighting layer already uses.

## What a firing rule does to each light

A light that is **on** takes the value immediately.

A light that is **off** depends on a **per-light setting**, edited in the
zone's Advanced section:

- *May be switched on* — the event turns it on at the rule's value.
- *Stage only* (the default) — it stays off, and the value is remembered as
  what it comes up at the next time it is switched on, by any control. The
  staged value is consumed by that switch-on and forgotten.

A zero-brightness rule switches lit lights off whatever this setting says, and
clears any staged value.

## Firing once

- The host records the last fired occurrence per rule, so a restart does not
  re-fire one that has already run.
- A missed occurrence (the host was down, the poll was late) fires if it is no
  more than 5 minutes late, and is skipped otherwise. Waking to a light change
  from hours ago is worse than missing it.
- While House Party is running, a rule defers exactly as pinned presets do
  today.

## What stays as it is

- **The neon 61% intensity threshold** (`intensityThresholds`). It is not
  time-based — it keys off the zone's brightness — so events do not replace it.
- **The conservatory pinned preset** (`entityPresets`, `pinned`). It means
  "whenever this fixture is on, it is warm white", which a fire-and-forget
  event cannot express, and the Conservatory zone also holds `light.hallway_2`,
  which the pin deliberately does not touch. Rules are zone-scoped, so
  converting it would drag that light in.

## The editor

In the zone's Advanced section (`specs/advanced-fold.md`):

- The zone's rules as a list: time, days, a colour swatch, and the slide
  switch for `enabled`.
- Add and edit: the time (clock, or sun event with an offset), day chips, and
  a `ZoneColorEncoder` for the value.
- Delete.
- Below it, one row per light in the zone with its "may be switched on by an
  event" slide switch.

## Done means

- A rule saved from the dashboard fires on the host at its time with every
  dashboard closed.
- A sunset-minus-30 rule fires at the right time on a day its weekday filter
  allows, and not on the others.
- Restarting the host does not re-fire a rule that already ran; a rule missed
  by more than 5 minutes is skipped.
- A zero-brightness rule switches the zone off, the neon included.
- With *stage only*, an off light is still off after the rule fires and comes
  up at the rule's colour the next time it is switched on.
- Unit tests cover sun offsets, day filters, once-per-occurrence, staging and
  zero brightness.
