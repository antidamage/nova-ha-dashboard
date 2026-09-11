# Weather refresh

How often weather data is fetched, by whom, and what the dashboard shows when a
fetch fails.

Produced by: no plan file — direct owner request on 2026-09-12, task-log entry
`20260911T202752Z-1b88f2f2`. Triggered by the 2026-09-11 outage below.

## Background

The weather source is Home Assistant's Met.no integration (`met` domain). HA
fetches from met.no; the dashboard reads the resulting `weather.*` entity from
HA and never contacts met.no itself.

On 2026-09-11 at 20:30 one met.no request failed with `ClientConnectorError`.
The entity went `unavailable` and stayed that way, because the integration's
built-in poll only runs every 55–65 minutes. While it was down the dashboard
called `weather.get_forecasts` several times a second: failed forecast calls
were never cached, so every state build retried. The same connection error also
occurred on 2026-09-06 and 2026-09-08.

## Rates

| Link | Rate | Mechanism |
|---|---|---|
| HA → met.no | once every 10 minutes | HA automation (below); the integration's own polling is off |
| Dashboard → HA forecast (`weather.get_forecasts`) | at most once a minute | `dashboard.timing.weatherRefreshIntervalMs` = `60000` |
| Dashboard ← HA entity state | push | the existing HA state-change subscription; no extra calls |

The 10-minute rate is chosen so that temperatures stay current. It is more
requests than the integration's default (about one an hour), not fewer.

## HA side

1. The Met config entry has **`pref_disable_polling: true`** ("Enable polling
   for changes" off in the entry's system options). This removes the
   55–65-minute built-in poll so the automation is the only scheduled fetch.
2. Automation **`nova_weather_refresh`**, alias "Nova weather refresh",
   `mode: single`, triggers on `time_pattern` `minutes: "/10"` (:00, :10, :20
   …). It resolves the entry from the entity with
   `config_entry_id('weather.forecast_home')`, so a re-added integration needs
   no edit, and branches on `config_entry_attr(entry, 'state')`:

   | Entry state | Action | met.no requests |
   |---|---|---|
   | `loaded` | `homeassistant.update_entity` on the weather entity | 1 |
   | `setup_retry`, `setup_in_progress` | nothing — HA is already retrying | 0 from the automation |
   | anything else (`not_loaded`, `setup_error`, `failed_unload`, …) | `homeassistant.reload_config_entry` | 1 |
   | entry disabled (`disabled_by` set) | nothing | 0 |

   A `loaded` entry whose last fetch failed shows the entity as `unavailable`;
   the next tick's `update_entity` recovers it without a reload. That covers
   the 2026-09-11 case.

   Reloading only when the entry is not loaded is deliberate. A reload during
   an outage puts the entry into `setup_retry`, and HA's own setup retries
   (5 s doubling to about 80 s, indefinitely) then run faster than 10 minutes.
   That is the one case where HA contacts met.no more often than the
   automation does, and it only happens when setup itself fails (after an HA
   restart, or a reload, during an outage).

3. Canonical YAML — HA stores it in `/config/automations.yaml` on the voice
   host; write it through HA's automation config API, not by hand-editing:

   ```yaml
   id: nova_weather_refresh
   alias: Nova weather refresh
   description: Fetch met.no every 10 minutes; reload the Met integration if it is not loaded. See nova-ha-dashboard/specs/weather-refresh.md.
   mode: single
   triggers:
     - trigger: time_pattern
       minutes: "/10"
   variables:
     weather_entity: weather.forecast_home
     entry: "{{ config_entry_id(weather_entity) }}"
     entry_state: "{{ config_entry_attr(entry, 'state') | string if entry else 'none' }}"
     entry_disabled: "{{ entry and config_entry_attr(entry, 'disabled_by') is not none }}"
   conditions:
     - condition: template
       value_template: "{{ entry and not entry_disabled }}"
   actions:
     - choose:
         - conditions: "{{ entry_state == 'loaded' }}"
           sequence:
             - action: homeassistant.update_entity
               target:
                 entity_id: "{{ weather_entity }}"
         - conditions: "{{ entry_state not in ['setup_retry', 'setup_in_progress'] }}"
           sequence:
             - action: homeassistant.reload_config_entry
               data:
                 entry_id: "{{ entry }}"
   ```

## Dashboard side

`lib/modules/weather/module.ts` and `lib/dashboard-events.ts`.

- **Interval.** `dashboard.timing.weatherRefreshIntervalMs` is `60000` in
  `config/dashboard-config.default.json` and in the live runtime config
  (`data/dashboard-config.json`, which outranks the default). The code fallback
  constant is also 60 s.
- **One call per interval.** The background timer refreshes the forecast every
  interval. The forecast cache lives for interval + 5 s, so a state build never
  starts its own fetch while the timer is running. Concurrent callers share one
  in-flight request (unchanged).
- **Failures are cached.** A failed `get_forecasts` is cached for the same
  lifetime as a success. Nothing retries before the next tick.
- **No call while the entity is down.** When the weather entity's state is
  `unavailable` or `unknown`, the dashboard does not call `get_forecasts` at
  all; HA would only answer 500.
- **Last good data on failure.** The dashboard keeps the last good
  `WeatherStatus` in memory, keyed by entity id. When the entity is
  unavailable/unknown, or the forecast call fails, `buildDashboardState`
  returns that last good status instead of nulls. It is lost on a dashboard
  restart; before the first success the old behaviour applies (condition from
  entity state, missing values null).
- **Warnings stay.** A failure still adds a line to `state.warnings`
  (`Weather forecast unavailable: …` or `Weather entity unavailable.`). There
  is no visual stale marker on the card.

## Done means

- Met entry shows `pref_disable_polling: true`; automation
  `automation.nova_weather_refresh` exists, is `on`, and its last trigger is
  within the past 10 minutes.
- HA log shows met coordinator fetches about every 10 minutes and no
  `Referenced entities weather.forecast_home are missing` spam.
- `/api/state` weather is populated; live `weatherRefreshIntervalMs` is 60000.
- Unit tests cover: one HA call per interval under repeated builds, a failure
  cached for the interval, no call while the entity is unavailable, and last
  good status returned on failure.
- `SPEC.md` §7 "Weather and sun" points at this spec.
