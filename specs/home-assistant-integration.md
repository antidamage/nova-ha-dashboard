# Home Assistant integration

## Home Assistant Integration

`lib/ha.ts` owns Home Assistant REST and WebSocket interaction.

REST behavior:

- `haRest` calls the HA REST API using `HA_URL` and `HA_TOKEN`.
- `callService` calls Home Assistant service endpoints.
- Missing `HA_TOKEN` raises a setup/runtime error for calls that require HA.

WebSocket behavior:

- `haWs` connects to the HA WebSocket API.
- Registry reads use HA WebSocket APIs for areas, devices, and entities.
- `subscribeHaStateChanges` listens for HA state change events and informs the
  dashboard event poller.

Dashboard entity discovery:

- Allowed domains are configured in `homeAssistant.controlDomains`.
- Hidden, disabled, and restored unavailable entities are filtered out, except
  configured dashboard sensor IDs required by the UI.
- Entity names come from registry metadata where possible, falling back to HA
  friendly names.
- Area assignment comes from entity registry first, then device registry, then
  an unassigned area.
- Dashboard zones are built from Home Assistant areas that contain dashboard
  entities.
- Unknown area IDs are retained instead of dropped.
- A network zone is ensured even if it is absent from HA registry data.
- The Home/Everything zone is prepended and includes inside controllable
  entities except configured exclusions, climate areas, network areas, and
  special outside exclusions.

Special entity classification:

- Switches whose names or IDs match configured illumination terms such as
  light, lamp, LED, strip, neon, glow, fairy, sign, or illumination are promoted
  into the lighting layer. Switches can also be promoted explicitly by the
  `nova_illumination` label or `homeAssistant.classification.forceIlluminationEntityIds`,
  which is how an outlet/switch (e.g. neon on a smart plug) is mapped in as a
  light (see Config-driven fixture policy in §12).
- Support switches such as auto-update switches are excluded using the
  configured support switch pattern.
- Outside lighting is intentionally excluded from broad inside/everything zone
  actions via `homeAssistant.everythingExcludedEntityIds`; every live
  outside-light entity id must be listed there (see §12).
- The old top-level Devices dashboard section was intentionally removed.

Router state:

- Router download/upload sensors are selected by configured preferred IDs or
  legacy sensor names.
- Units are normalized to MB/s.
- Router reads use a short cache so the router panel can poll quickly without
  hammering HA.

Weather and sun:

- Weather reads use the configured `weather.*` entity.
- Daily forecast data is fetched through HA `weather.get_forecasts`.
- The dashboard asks HA for the forecast at most once a minute
  (`dashboard.timing.weatherRefreshIntervalMs`); failures are cached for the
  same interval, no call is made while the entity is unavailable, and the last
  good status is shown during a failure. HA fetches from met.no every 10
  minutes via an automation. Detail: `specs/weather-refresh.md`.
- The dashboard derives conditions, temperature, min/max, rain chance, wind,
  UV, humidity, and feels-like data where available.
- Sun state comes from the configured `sun.sun` entity.

## Dashboard State

`buildDashboardState` returns the primary dashboard snapshot:

- `generatedAt`
- zones and entities
- warnings
- router metrics
- weather
- sun
- preferences

Warnings are produced when important dashboard categories are missing or
registry reads fail.

The API route `/api/state` returns this state, publishes it to connected SSE
clients, and includes build/event metadata.

## Realtime Events

`lib/dashboard-events.ts` owns server-side event fanout and background timers.

Primary SSE endpoint:

- `/api/events`

Events include:

- `client-id`
- `build`
- `reload`
- `state`
- `dashboard-error`
- `tasks`
- `task-alert`
- `task-dismiss`
- `task-audio`
- keepalive comments

When a dashboard client connects:

- The server sends retry timing.
- The server assigns a client ID.
- The server sends current build metadata.
- The server sends cached dashboard state if available.
- The server sends the current task snapshot.
- The server sends current task-audio status.
- The server starts shared pollers if not already running.

Pollers and subscriptions:

- Dashboard state poll.
- HA state-change WebSocket subscription.
- Build ID poll.
- Weather refresh.
- Task alert tick.
- iCloud sync.
- Adaptive candlelight transition poll.
- Heartbeat/keepalive.

Pollers stop when there are no dashboard or task clients.

State publish rules:

- State events are deduplicated by signature, excluding generated timestamps.
- Light command holds temporarily prevent HA polling from overwriting
  optimistic light UI state.
- Remembered spectrum cursor data is retained per zone.
- HA state changes for relevant domains trigger debounced state refresh.
- Build ID changes emit `reload`.
- If the page has been unable to refresh state for the configured outage
  duration while visible, the client reloads.

## Entity Control

Entity actions are sent to `/api/entity`.

Allowed domains:

- `light`
- `switch`
- `climate`
- `fan`
- `cover`
- `humidifier`

Sensors are read-only.

Climate service allowlist:

- `turn_on`
- `turn_off`
- `set_hvac_mode`
- `set_temperature`
- `set_fan_mode`
- `set_swing_mode`

Other supported domains are limited to the service patterns used by the UI.

Entity actions can include a `remember` payload. Remembered values are merged
into dashboard preferences after the HA call succeeds.

Aircon-related entity actions are logged with extra detail for debugging.
