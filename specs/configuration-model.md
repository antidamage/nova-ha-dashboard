# Configuration model and persistence

## Configuration Model

The checked-in default configuration is assembled from
`config/dashboard-config.default.json`, setup-oriented `config/common.json`, and
task setup `config/tasks.json`. Runtime configuration is merged over those
defaults and validated by `lib/config-schema.ts`.

`config/orb-modules/` holds hot-droppable status orb module JSON files served
by `GET /api/orb-modules` (see Status Orb Modules); these are standalone
documents outside the merged dashboard config and its schema.

Configuration is JSON and uses `schemaVersion: 1`.

Main configuration areas:

- `homeAssistant`: domains, entity patterns, excluded entities, weather/sun
  entities, router sensors, dashboard sensor IDs, Nova assist satellite, and
  zone naming rules.
- `dashboard`: special zone IDs, command-hold timings, event poll timings,
  weather refresh timing, adaptive lighting polling, avatar widget settings,
  climate settings, and build reload outage behavior.
- `mapWeather`: map center, RainViewer manifest/fallback URLs, radar refresh
  and preload settings, and satellite tile URL template.
- `power`: timezone, billing cycle dates, sampling/publish intervals, Powershop
  rate URLs, and modeled base load definitions.
- `tasks`: iCloud sync settings, alert audio file, max upload size, alert
  window, and repeat interval.
- `theme`: default theme scope and shared theme poll interval.
- `mcp`: enabled state, bearer auth requirement, allowed origins, mutation
  permissions, and confirmation requirement.

`lib/dashboard-config.ts` responsibilities:

- Read the default, common, and tasks config files synchronously or
  asynchronously.
- Read runtime config if present.
- Apply compatibility overrides from environment where supported.
- Deep-merge runtime config over defaults.
- Validate with Zod.
- Export JSON schema from the Zod schema.
- Dry-run config imports.
- Write runtime config atomically, with queued writes to avoid concurrent file
  corruption.
- Return setup status for secrets.
- Redact config for export. Current config contains no secrets, so redaction is
  currently a pass-through.

Configuration UI:

- `/config` renders a config workspace.
- It displays current config JSON.
- It can refresh, export, validate, import, and download/view schema.
- It shows setup status for HA URL/token, iCloud username/password, Powershop
  email/password, and MCP bearer token.

## Persistence

The app stores mutable local state in JSON files under `data/` by default.

- `data/dashboard-config.json`: runtime config overrides.
- `data/dashboard-preferences.json`: dashboard preferences, remembered device
  settings, theme, and adaptive lighting state.
- `data/dashboard-tasks.json`: local tasks plus mirrored iCloud task records.
- `data/power/state.json`: integrated power monitor state.
- `data/power/device-ratings.json`: optional device wattage overrides.
- `data/power/account-usage.json`: optional account usage overrides.
- `data/power/powershop/*.json`: Powershop daily scrape outputs.
- `data/gymmaster/latest.json`: latest GymMaster attendance scrape status,
  selected visit timestamp, and non-secret extraction evidence.

Preference writes and task writes are queued and atomic.

`lib/preferences.ts` stores:

- Aircon preferences such as mode, target temperature, fan speed, quiet/turbo,
  fresh air, auto mode, and the off timer.
- Panel heater preferences such as the off timer.
- Lighting preferences, including adaptive candlelight zone state and last sun
  state.
- Shared theme preferences.
- Watchface preferences. `watchface.gymLastResetAt` is retained for API and
  watchface compatibility, but now represents the latest scraped GymMaster gym
  visit timestamp rather than a user tap/reset timestamp.
- Status orb info preferences (`orbInfo`): the selected readout module id and a
  per-module map of display configuration and parameters. `mergeDashboardPreferences` merges
  BOTH levels — the object and its `modules` map — so saving one module's
  display never wipes another's, and changing the selection never wipes the
  saved displays.
