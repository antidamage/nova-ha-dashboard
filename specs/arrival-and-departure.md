<!-- START HERE, never here alone: read D:\Projects\Agent\AGENTS.md, then this repo's specs/README.md (the suite, in order). This file is one part of it. -->
# Arrival and departure

Two endpoints that put the house into a state when a household member arrives or
leaves, and the place that state is configured.

| File | Holds |
|---|---|
| `lib/config-schema/arrivals.ts` | the state, target-kind and preset schemas |
| `lib/config-schema/power.ts` | `HouseholdPerson`, which carries the two state lists |
| `lib/config-schema/dashboard-config.ts` | `dashboard.arrivals` |
| `lib/arrivals/member-model.ts` | resolving `<name>`, and reading a member's list |
| `lib/arrivals/apply-model.ts` | applying a list and reporting every entry |
| `lib/arrivals/targets.ts`, `lib/arrivals/targets/` | the target registry and its three targets |
| `lib/arrivals/run.ts` | the endpoints' behaviour and response shape |
| `app/api/arrival/[name]/route.ts`, `app/api/departure/[name]/route.ts` | the endpoints |
| `app/api/arrivals/route.ts` | the config section's read and write |
| `app/components/config/arrival/` | the Arrival & Departure config section |

## Members are `dashboard.people`

There is one household member list, and this feature did not invent a second one.
`<name>` is matched against `dashboard.people` by `id` or `label`,
case-insensitively; the list lives in config, this house's copy in the household
package, and nothing about any person is written into source. A name that matches
nothing is a `404` naming the names the dashboard does know — never a near-miss.

The list is edited under Voice & People → User Data → Arrival & Departure, which
is also the first UI `dashboard.people` has ever had. Because power attribution
reads the same list (`lib/washing.ts`, `lib/power/ha-publish.ts`), a member added
here is selectable in the washing machine card too: one list of people, two
things that use it.

## A state is a target and a preset id

A member carries `arrival` and `departure` arrays. One entry is
`{ target, presetId }` and nothing else — deliberately, so the config never learns
what an air-conditioning preset or a volume preset looks like:

```json
"people": [
  {
    "id": "ada", "label": "Ada", "color": "#22d3ee", "primary": true,
    "arrival": [{ "target": "lighting", "presetId": "adaptive-office" }],
    "departure": [{ "target": "lighting", "presetId": "builtin-off:office" }]
  }
]
```

`ARRIVAL_TARGET_KINDS` in `lib/config-schema/arrivals.ts` is the enum, and
`lib/arrivals/targets.test.ts` fails unless `ARRIVAL_TARGETS` registers exactly
those kinds: adding a fourth kind is a new file under `lib/arrivals/targets/`,
one line in the registry and one line in the enum, and nothing else.

## The targets

| Target | Its presets | Applying one |
|---|---|---|
| **Lighting** | the zone light rules of kind `preset` / `adaptive` — a room's preset-button row, which already includes built-in **On** and **Off** for every zone — plus the default **Adaptive** and **White** | `triggerZoneLightRule`, the same call `POST /api/lighting/zone-rules/[id]/trigger` makes |
| **Air conditioning** | `dashboard.arrivals.climatePresets`, which ships empty | `applyClimateControlIntent` with the preset's `instanceId` as the room, after checking that instance is configured |
| **Volume** | `dashboard.arrivals.volumePresets`, which ships empty | sets `theme.controlSound.volume` on both theme variants — the dashboard's own sound volume, the Volume slider under Theme & Experience → Sound |

Nothing is duplicated out of the zone editor: a lighting preset that changes its
colour or is renamed changes what an arrival can pick. Air conditioning and volume
had no named presets before this, so theirs are config arrays with no UI authoring
them yet — the target is registered, its list is honest about being empty, and the
picker says so rather than inventing a preset. A state naming a preset that is not
there fails loudly, naming it.

## The endpoints

`GET /api/arrival/<name>` and `GET /api/departure/<name>`. Both are `GET`, like
the other shortcut routes (`/api/all-lights/off`) that iOS Shortcuts and Home
Assistant call, and both sit behind the site's existing authentik `forward_auth`
(any `Authorization` header satisfies it).

| Case | Status | Body |
|---|---|---|
| every entry applied | 200 | `{ member, event, ok: true, states: [{ target, presetId, ok }] }` |
| nothing configured for this event | 200 | the same, `states: []`, plus a `note` naming the member |
| an entry failed | 500 | the same with `ok: false` and that entry's `error` — **every remaining entry was still applied** |
| no such member | 404 | `{ error, members: [...] }` |

An arrival is an event: there is no cooldown and no de-duplication, and firing one
twice re-applies the same presets rather than being swallowed. A partial failure
is a 500 listing each entry because the caller is an automation, and a state it
asked for that did not land is a fact it needs. One of them becomes an attributed
dashboard event (`service: "arrivals"`, summary "… arrived" / "… left"), so it
appears in the activity panel and the digest.

## The volume it sets

**The dashboard's own sound volume** (owner, 2026-09-26), not the voice reply
volume and not a Home Assistant media player — the dashboard configures no
media-player volume at all. It is one number per theme variant, so a preset writes
both; a volume that applied only in dark mode would be a state the arrival
silently failed to set. It is written with `mergeDashboardPreferences` exactly as
`POST /api/theme` writes it, and an open dashboard picks it up on its
`SHARED_THEME_POLL_MS` (30s) shared-theme poll.

## What is not here

No scheduling: nothing fires an arrival on a timer or from presence. No per-zone
scoping of an arrival, and no whole-house lighting preset — a "leave the house"
set is one entry per room, because a house-wide preset would be a new rule kind
with its own host behaviour. No authoring UI for the air-conditioning or volume
preset lists. No notification beyond the attributed event.
