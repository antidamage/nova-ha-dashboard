# Config vs Home Assistant: where each setting lives

Nova is designed so that **most configuration happens in Home Assistant simply by
adding and organising devices**. The dashboard's own config file holds only what
HA cannot express. This document defines that boundary so settings don't end up
"too mixed".

## The rule of thumb

> If Home Assistant can express it, configure it in Home Assistant.
> If it's an opinion about how Nova presents your home, put it in config.

## Home Assistant owns "what exists" (no Nova config needed)

These are read live from HA every refresh. Change them in HA and Nova follows:

| Concern | Home Assistant mechanism |
|---|---|
| Which devices/entities exist | entity registry + `/api/states` |
| Which room an entity is in | entity area, or its device's area |
| A room's trusted temperature/humidity | **Area → sensor bindings** (`area.temperature_entity_id`, `area.humidity_entity_id`) |
| Whether a sensor is environmental | `device_class: temperature` / `humidity` |
| Whether a switch is really a light | name, or the `nova_illumination` **label** |
| Whether a control is hidden plumbing | the `nova_hidden` **label** |
| Friendly names | entity/device names |

**Labels are the primary knob.** To change classification, add a label to the
device in the HA UI — no Nova redeploy. Nova honours these label slugs by default
(configurable under `homeAssistant.classification`):

- `nova_illumination` — treat a switch as a light.
- `nova_hidden` — hide an entity from the dashboard.
- `nova_environment` — surface a sensor as a room environment reading.

## Config owns "how Nova presents it" (HA can't express this)

In `config/common.json` (overrides `config/dashboard-config.default.json`):

- **Area roles** — which HA areas are organisational groupings rather than rooms:
  - `homeAssistant.climateAreaNames` — areas that group climate devices.
  - `homeAssistant.networkZoneId` — the area that represents the router/network.
- **Aggregate composition** — what the synthetic "Home" zone leaves out:
  - `homeAssistant.everythingExcludedEntityIds` — e.g. `light.outside_light`, so
    the outside light is its own zone but not part of "Home". (This is the
    canonical "outside is a room in HA but not in Home" case.)
- **Synthetic zones** not backed by any HA area: `dashboard.specialZones`
  (Power, Reminders) and `dashboard.defaultZoneId`.
- **Bindings** — point Nova at the specific entity for a singleton concern that
  isn't area-scoped: `weatherEntityId`, `sunEntityId`, `router.*`,
  `novaAssistSatelliteEntityId`. (`weatherEntityId`/`sunEntityId` fall back to
  `weather.*` / `sun.sun` auto-detection.)
- **Everything non-HA**: map center, power billing/rates, theme, timings, MCP.
- **Power device ratings** — `power.deviceRatings`. HA knows a bulb exists; it
  does not know it draws 15.5W. Each entry carries the wattage plus every
  entity ID the device may appear under, so renaming an entity is a config edit
  rather than a code change. During a rename, list the old and new IDs together
  and the first one present in HA wins.

## Escape hatches (use sparingly)

When HA metadata is missing or wrong, override per-entity under
`homeAssistant.classification`:

- `forceIlluminationEntityIds`, `forceHiddenEntityIds`
- `environmentSensorEntityIds` (force-show), `environmentSensorExcludeEntityIds`
- `illuminationNamePattern`, `supportSwitchPattern` (regex fallbacks)

Prefer fixing the metadata in HA (a label, an area assignment, a `device_class`)
over adding an entity id here. The legacy `loungeSensorEntityIds` list still
works (it's unioned into the environment include set) but new homes should rely
on area assignment + bindings instead.

## Fresh install

`dashboard-config.default.json` is generic and complete: a brand-new deploy with
no `common.json` validates and runs, classifying purely from HA metadata. Copy
`config/common.example.json` to `config/common.json` and adjust, or let an agent
configure it over MCP (see `public/agent/skills/nova-dashboard-management`).
