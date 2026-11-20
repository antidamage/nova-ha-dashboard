<!-- START HERE, never here alone: read C:\workspace\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Home users

Several people share the house. Each device asks who is using it. That person
sees only their own rooms and their own Quick Access. The house reacts to who is
home: lights come on for the first arrival, go off when the last person leaves,
and partial arrivals and departures touch only that person's rooms. At night,
adaptive lighting stays at or below the lowest maximum brightness of the people
who are home and share a room.

Owner: alex, 2026-11-19 (ticket 684437). Plan codename:
`we-re-building-out-a-validated-muffin`.

| File | Holds |
|---|---|
| `lib/config-schema/home-users.ts` | the person fields this adds, `dashboard.zones`, quick-access entry schema |
| `lib/home-users/` | pure models: a user's rooms and lights, the view filter, quick-access synthesis, the night cap |
| `lib/presence/` | the presence store, the occupancy rule model, its applier, `runPresenceEvent` |
| `app/api/im-home/[name]/route.ts`, `app/api/im-leaving/[name]/route.ts` | the presence endpoints |
| `app/api/arrival/[name]`, `app/api/departure/[name]` | aliases of the two above |
| `app/components/home-users/` | the identity chooser, the logout button, the who-is-home row, the local identity store |
| `app/components/config/arrival/` | the **Home Users** config section (formerly Household members) |

## 1. People are `dashboard.people`

There is one list of people (`specs/arrival-and-departure.md`). This feature adds
fields to it rather than inventing a second list. Every field has a default, so a
config written before this feature loads unchanged.

Each field is optional in the schema, so older person records stay valid; the
defaults below are applied by every reader.

| Field | Type, default | Meaning |
|---|---|---|
| `rooms` | zone ids, `[]` | the room zones this person sees and controls |
| `showSystemTabs` | boolean, `false` | whether this person sees Home (the aggregate zone) and the Systems accordion: Climate, Outside, World, Network, Grid, Reminders, Voice |
| `quickAccess` | entries, `[]` | this person's Quick Access card, in order (§4) |
| `nightMaxBrightnessPct` | 1-100, `60` | the brightest adaptive lighting may be at night in this person's rooms while they are home (§6) |

`60` is the existing evening adaptive brightness
(`DEFAULT_EVENING_LIGHT_BRIGHTNESS_PCT`), so a person added with defaults changes
nothing.

**A person is a home user when they have at least one room.** Only home users
appear on the identity chooser and the who-is-home row, and only they count
toward presence. A person with no rooms (kept for wash attribution) appears on
neither. The wash attribution cycle (`specs/power-meters.md`) reads the same
list, so a new person also joins that cycle. Labels there resolve by id, so a
renamed person keeps their history.

### A user's lights

`controlledZones(person)` = `rooms` ∪ the zone of every `room-lights` entry in
their `quickAccess`. A user's lights are the light-layer entities
(`lightLayerEntities`) in those zones, excluding the `homeAssistant.everythingExcludedEntityIds`
list only where that list already applies (the Home zone). "All lights", the
first-arrival rule and the night cap all use this set.

## 2. Zone metadata: `dashboard.zones`

`dashboard.zones` is an array of `{ zoneId, bedroom, arrivalLight }`, both
booleans default `false`, ships empty. It is keyed by zone id, which is the
Home Assistant `area_id` and does not change when the area is renamed.

- `bedroom`: the room is someone's bedroom. Its **owners** are the home users who
  have it in `rooms`. Departure, arrival and the night cap treat a bedroom as its
  owners' alone.
- `arrivalLight`: the room is lit for a later arrival after sunset (§5).

`isBedroomZone` in `app/components/dashboard/shell/zone-model.ts` is not this
flag. It selects the legacy heater room's temperature panel by zone id, which
survives a rename, and it is left as it is.

## 3. Identity on a device

Identity is a **per-device view preference**. It is not authentication, and it
has nothing to do with authentik, face login or kiosk attribution. Anyone can
switch identity on any device, and the Household view shows every room. alex
asked for exactly this; the restriction is about a tidy view, not about access.

- localStorage key `nova.dashboard.homeUser.v1`, value a person id or
  `"household"`. It is owned by `app/components/home-users/homeUserSetting.ts`
  (`readHomeUser`, `writeHomeUser`, `clearHomeUser`, `useHomeUser`). Writes
  dispatch `nova-home-user-change` and the hook listens to `storage`, like the
  experience-mode key.
- A stored id that no longer names a home user reads as undecided.
- Nothing is written to the server, and nothing is written without a tap.

### The chooser

`HomeUserChooser`, mounted in `DashboardGlobalServices.tsx` with the same
hydration rule as `ExperienceModeModal` (it renders nothing on the server or on
the first client render).

- It shows when no valid identity is stored **and** at least one home user exists.
  An installation with no home users never sees it and behaves exactly as before.
- It uses the `system-confirm` overlay and card. The title is "Who's using this
  device?". The body is a grid of tiles: a colour square in the person's colour,
  with the person's name under it, one tile per home user in list order, then a
  **Household** tile (a neutral square, the theme's line colour) that means
  "everyone".
- No close button, no outside-click dismiss, and Escape does nothing. A choice
  is required. Focus starts on the first tile and stays inside the dialog. Each
  tile is a `button` at least 88px square with the house focus ring.
- `docs/control-inventory.md` has no selection-tile control, so the tile grid is
  new. It is added to the inventory as `HomeUserTile`.
- **Order:** the experience chooser (`ExperienceModeModal`) waits until an
  identity is stored, then shows as it does today. If the page reloads between
  the two, the next load resumes at the experience step and does not ask the
  identity again.

### What a user sees

`viewForHomeUser(tree, person)` in `lib/home-users/view-model.ts` filters
`buildZoneTree`'s output:

| Identity | Home zone | Room zones | Systems accordion | Quick Access |
|---|---|---|---|---|
| undecided, or `household` | shown | all | shown | the shared `dashboard.controls` slots |
| a person with `showSystemTabs` | shown | their `rooms` only | shown | theirs (§4) |
| a person without `showSystemTabs` | hidden | their `rooms` only | hidden | theirs (§4) |

A room in `rooms` that is a system zone (Outside) appears in Systems, not in the
room list. A person whose filtered room list is empty sees the line "No rooms are
assigned to <name>. An admin can add them in Config → Home Users." in place of
the list. A selected zone the user cannot see falls back to their first visible
zone.

### Log out

A `LogOut` icon button sits in the top floating set, immediately after the config
link, using the config link's button class and tooltip attributes. It renders only
when an identity is stored. It carries a 2px ring in the person's colour, with
`aria-label` and tooltip "Log out (viewing as <name>)".

The button opens the system-confirm dialog: "Log out <name>?" / "This device will
ask who is using it, and the experience level, again." with Cancel and Log out
buttons. Confirming clears `nova.dashboard.homeUser.v1` **and**
`nova.dashboard.experienceMode.v1` (through `clearExperienceModeSetting`, which
also clears the `<html>` flags). The identity chooser then shows, followed by the
experience chooser.

## 4. Per-user Quick Access

`quickAccess` is an ordered list of entries:

| Entry | Becomes |
|---|---|
| `{ kind: "preset", presetId }` | any control preset that exists (aircon, heater, amplifier, outside weather, host temperatures, room lighting) |
| `{ kind: "room-lights", zoneId }` | a `room-lighting` control for that room, named by the zone's current name |
| `{ kind: "all-lights" }` | a `room-lighting` control named "All lights" bound to the user's lights zone (§4.1) |

`quickAccessControlsFor(person, controls)` in `lib/home-users/quick-access-model.ts`
synthesises a `ControlsConfig`: the stored presets, plus one generated preset for
each `room-lights`/`all-lights` entry (ids `home-user:<person>:room:<zone>` and
`home-user:<person>:all-lights`), plus `quick-access` slots for the entries in
order. `useSlotItems` gets this config when a person is selected, so the card
renders through the existing renderers with no new control code. An entry whose
preset or zone no longer exists is dropped, as a slot is today. A person with an
empty `quickAccess` gets an empty card, not the shared one.

### 4.1 The All lights zone

`buildDashboardState` builds one zone per home user: id `member:<personId>`, name
"All lights", `special: "member"`, holding the user's lights (§1). It travels in
the state's own `memberZones` field, **not** in `zones`, so nothing that lists
rooms (the room menu, voice, the camera and tint zone pickers, house party, the
Apple TV) ever sees it. Lighting commands find it through `findZoneWithMembers`
(`lib/ha/zones.ts`), so zone commands, adaptive, brightness and the spectrum work
on it unchanged. The
existing `/api/all-lights/*` routes and the Home zone are unchanged.

## 5. Presence and the occupancy rules

### Store

`data/presence.json` (path override `NOVA_DASHBOARD_PRESENCE_PATH`), written
atomically: `{ members: { <personId>: { home: boolean, changedAt: ISO } } }`. A
person with no entry is away. The state payload carries `homeUsers`: every
home user's fields plus `home` and `changedAt`, with `homeZones` beside it.
`GET /api/home-users` serves the same list from config and this file alone, for
the identity chooser.

### Endpoints

`GET /api/im-home/<name>` and `GET /api/im-leaving/<name>`. `<name>` resolves like
the arrival routes: id or label, case-insensitive, a miss is a 404 listing the
names. They sit behind the same forward-auth as every shortcut route.
`/api/arrival/<name>` and `/api/departure/<name>` are aliases and run exactly the
same code.

The run order is: resolve the member, read who was home, decide the actions (pure
model), record the new presence, apply the actions, then apply the member's
configured arrival/departure preset list (`specs/arrival-and-departure.md`), and
re-check the night cap (§6).

Response, extending the arrival shape:

```json
{ "member": "ada", "event": "arrival", "ok": true, "changed": true, "replayed": false,
  "home": ["ada"], "actions": [{ "kind": "lights-on", "zones": ["kitchen"], "ok": true }],
  "states": [] }
```

`changed: false` means the member was already in that state. Then no occupancy
action runs (`actions: []`); the preset list still applies, which keeps the old
routes' "an event re-applies" contract. Any failed action or state is a 500 with
every entry listed. Every remaining entry is still attempted. Each call is one
attributed event (`service: "arrivals"`, summary "<name> arrived" / "<name>
left").

**A failed action is retried by repeating the call.** A transition is recorded
with a `pending` marker (`{ event, homeBefore }`) that is cleared only once every
action has succeeded. While it is set, a repeat of the same event is not "already
there": it replays the actions, decided against who was home when the transition
first happened, and reports `replayed: true`. The opposite event supersedes a
pending transition. Without this, a last-out while Home Assistant was down would
record the house as empty, fail to switch anything off, and make every retry a
no-op (review of PR #176).

A person without rooms (not a home user) gets the old behaviour only: their
preset list, with no presence change and no occupancy actions.

### The rule model

`decidePresenceActions({ event, member, people, zones, homeBefore, sunUp })` in
`lib/presence/rules-model.ts` returns an ordered list of actions. "Others" means
home users other than the member who are home before the event.

| Event | Others home? | Sun | Actions |
|---|---|---|---|
| leaving | none | any | `lights-off: house` (every light-layer entity) · `heater-off` for each heater in the member's bedrooms |
| leaving | some | any | `lights-off` the member's bedrooms that no remaining home user also owns · `heater-off` for those bedrooms' heaters |
| home | none | any | `lights-on` every zone in `controlledZones(member)` |
| home | some | up | `lights-on` the member's bedrooms |
| home | some | down | `lights-on` the member's bedrooms ∪ (`controlledZones(member)` ∩ `arrivalLight` zones) |

- **Lights only.** `lights-off` goes through `setAllLightingAction` /
  `setZoneLightingAction` with action `off`, which switch only the light layer.
  The zone `off` lighting command is never used here, because it also switches
  off climate entities.
- `lights-on` uses `setZoneLightingAction` with action `on`, mode `adaptive`, for
  each zone: the adaptive preset with the night cap (§6). The Outside zone
  (`isOutsideZone`) uses mode `power`, as the outside-light shortcut does, so
  outside lights are switched on and off, with no dimming.
- **Heaters.** A zone's heater is a configured heater instance whose `zoneId` is
  that zone, or, for an instance with no `zoneId`, whose id is that zone's id
  (the legacy single-heater instance is keyed by its room). `heater-off` calls `applyClimateControlIntent` with mode `off` and
  is attributed `departure`. That drops Auto and keeps the stored target. No rule
  ever writes heater mode `auto` or `on`, so an arrival never turns a heater on.
  A flap at night (leave, then home) leaves the heater off until someone turns it
  on, which is the behaviour asked for. This is a user event, not a time of day,
  so the heater's "no clock schedule" rule holds.
- **Aircon** is never touched by any rule.
- `sunUp` is `sun.state === "above_horizon"`. An unreadable sun counts as down,
  which is the generous direction (more lights on).

### Known risk: geofence flapping

A phone at the edge of a geofence can send leave/home/leave. The server cannot
tell a flap from a real exit, so it takes no debounce. The mitigations are the
app's own dwell/loitering delay (the setup guide sets one) and the one-tap
correction on the who-is-home row.

## 6. Night maximum brightness

At night (adaptive mode `candlelight`), every light-layer entity gets a cap:

```
cap(entity) = min( nightMaxBrightnessPct of every home user who is home
                   and whose controlledZones contain a zone holding the entity,
                   ignoring bedroom zones the user does not own )
```

With no such user, the entity has no cap and today's 60% default stands. The cap
is a ceiling: `adaptiveLightBrightnessPctForEntity` returns
`min(its existing value, cap)`. Because every adaptive path (zone On, candlelight,
the adaptive transition at sunset, all-lights shortcuts, optimistic state) goes
through that function, they all respect it. The cap travels in the state's
`lighting.nightCapPctByEntity`. It is computed in `buildDashboardState` by
`nightCapsFor(people, zones, presence)` in `lib/home-users/night-cap-model.ts`.

- A brightness someone enters (the intensity control, `brightness` commands)
  does not pass through the adaptive function and is never capped. The entered
  value wins.
- Pinned fixtures are exempt. `applyPinnedPreset` reads its brightness without
  the cap, so a pinned light keeps its fixed look.
- **Re-check on every presence change.** After the actions, `reapplyNightCaps`
  goes through every light that is on, at night, in a zone remembered as adaptive
  (`preferences.lighting.adaptiveCandlelightZones`, or the zone just switched on
  by the rule). For each one it re-sends the adaptive brightness when the light
  is more than 2 points away. That lowers lights when a lower-cap user arrives, and
  raises them back to the default when that user leaves.

Worked example, this house: alex 60%, Lilith 5%. Lilith gets home at 21:00 with
alex home. Her bedroom and the kitchen go on at 5%. Outside is switched on, with
no dimming. The lounge stays at 60%, because Lilith does not have the lounge.
When Lilith leaves, her bedroom light goes off, and the kitchen, if on and
adaptive, rises back to 60%.

## 7. The who-is-home row

`HomePresenceRow`, between `ClockPanel` and `ReminderIconBar` inside
`.dashboard-overview`. It renders nothing when there are no home users.

- One button per home user, in list order: a lucide `User` icon with the name
  under it. Home: the icon and name are drawn in the person's colour. Away: the
  extract's disabled text token at reduced opacity. The name is always present,
  so colour is never the only signal.
- `aria-label` and tooltip: "<name>: home since <time>" / "<name>: away since <time>".
- The hit area is at least 44px, with the house focus ring.
- Tapping opens the system-confirm dialog to correct the state. The dialog
  states the consequence, worded from `decidePresenceActions`' preview, e.g.
  "Mark alex away? Nobody else is home, so every light turns off." Confirming
  calls the same route (`im-home` / `im-leaving`).
- alex's chosen colours (orange-red, intense neon green) are not in the design
  extract. They are her values and are recorded as her departure; every other
  value in the row comes from `docs/design-extract/`.

## 8. Home Users config section

The Household members accordion (Voice & People → User Data) is renamed **Home
Users** and extended. Per person it shows, in order:

1. name (saved on blur) and colour (`ColorEncoder`, written on release), as today;
2. **Rooms**: a checkbox row per room zone (system zones included), using the
   existing switch row control;
3. **Show system tabs**: a switch;
4. **Night maximum brightness**: the existing percent slider control, 1-100;
5. **Quick Access**: the ordered list, with Add (a `ConfigSelect` offering "All
   lights", "<room> lights" for each controlled zone, and each existing preset),
   remove, and move up/down;
6. primary, and the arrival/departure preset lists, as today.

Below the people is a **Rooms** list: one row per room zone, with **Bedroom** and
**Lit for a later arrival after sunset** switches (`dashboard.zones`). Every edit
writes through `app/api/arrivals/route.ts`, which now also reads and writes
`dashboard.zones`.

## 9. Labels follow the zone name

Room names come from Home Assistant areas and are never copied into labels the
dashboard generates. Generated room-light presets are named by the zone's current
name at render. A climate control on Quick Access is titled by its room's current
name: the preset's room, or, for a legacy instance with none, the zone its id
names (`app/components/home-users/climateTitle.ts`). In Home
Assistant, entity ids are never renamed. Friendly names that spell out a room (for
example "Bedroom heater") are renamed to the fixture's role ("Heater"), so HA shows
them under the area's name and a new occupant's name carries through. The
household changelog for ticket 684437 lists each rename.

## 10. Surfaces

Web only, for now. The Apple TV and iPhone apps read the state payload, and the new
fields (`homeUsers`, `homeZones`, `memberZones`, `lighting.nightCapPctByEntity`)
are additive and kept out of `zones`, so those apps are unchanged.

## 11. Done means

- Every rule-table row and the night-cap formula have unit tests, including the
  sun-up and sun-down cases, alone and with others home, and a test that no
  presence path ever writes heater mode other than `off`.
- `lib/fresh-install.test.ts` and `lib/no-household-data.test.ts` pass. No
  person, room or entity name from this house is in source.
- The chooser, logout, filtering, presence row and per-user Quick Access are
  checked on the rendered page.
