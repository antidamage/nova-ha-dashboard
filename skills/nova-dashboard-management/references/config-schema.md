# Config Schema

Portable config is JSON with `schemaVersion: 1`. The checked-in defaults are assembled from `config/dashboard-config.default.json`, `config/common.json`, and `config/tasks.json`.

Top-level groups:

- `homeAssistant`: entity IDs, area aliases, controllable domains, router/weather/sun mappings, exclusions, and naming patterns.
- `dashboard`: default zone, virtual zones, lighting behavior, climate settings, avatar settings, and dashboard timing.
- `mapWeather`: map center, radar provider, satellite provider.
- `power`: `timeZone`, billing days, timing, modeled base loads, plus three blocks that ship EMPTY because they describe one household: `rates.tariff` (the electricity plan's unit rates), `accountHistory` (billed usage imported from the retailer), and `deviceRatings` (each device's watts and the entity IDs it may appear under). Power estimation reports itself inactive and shows no Power zone until both a tariff and device ratings exist. Renaming or retiring a device is a `deviceRatings` edit, not a code change; list both the old and new entity ID during a rename and the first one present in HA wins.
- `tasks`: iCloud allow-lists and task alert audio limits. First-time task setup lives in `config/tasks.json`.
- `theme`: shared/local theme defaults.
- `mcp`: auth, Origin, and mutation guardrails.

Portable config excludes secrets and machine-local paths. Runtime environment still owns:

- `HA_URL`
- `HA_TOKEN`
- `ICLOUD_USERNAME`
- `ICLOUD_APP_PASSWORD`
- `POWERSHOP_EMAIL`
- `POWERSHOP_PASSWORD`
- `NOVA_DASHBOARD_MCP_TOKEN`

Nothing specific to one home may go in dashboard source — no entity IDs, area names, device IDs, hostnames, IPs, timezones or tariffs. It lives in config, and the values for this particular installation live in a separate household package merged via `NOVA_DASHBOARD_HOUSEHOLD_CONFIG`. `lib/no-household-data.test.ts` fails the build if one reappears; SPEC.md §2 and §32 have the rule and the module contract.

Always call `nova.config.validate` before `nova.config.apply`.
For setup-only edits, put common Home Assistant/map/power values in `config/common.json`. Do not put settings that are managed by `/config` there.

Lighting behavior can include intensity threshold blocks and per-light preset overrides. Unconfigured lights use the dashboard defaults: 60% brightness for evening candlelight and 100% for daytime daylight.

- `intensityThresholds` make a lighting-layer entity on/off-only: it is suppressed (turned off) whenever the zone is set below `thresholdPct`, and turned on at or above it. Works for any entity in the lighting layer — a real `light.*`, or a `switch.*`/outlet promoted with the `nova_illumination` label or `homeAssistant.classification.forceIlluminationEntityIds`. Use it for a switched fixture with no dimming (e.g. neon on a smart outlet).
- `entityPresets` with `pinned: true` lock a fixture to a fixed look: it ignores the zone's brightness/colour and is always (re)driven to `targetBrightnessPct` + `colorTemperatureOverrideKelvin`, reapplied on every manual zone edit and by the scheduled lighting poller. ~3000K is warm white; ~6500K is cool/bright white. Without `pinned`, the preset only supplies the per-entity brightness/colour-temperature used by the adaptive On/candlelight presets.

```json
{
  "dashboard": {
    "lighting": {
      "intensityThresholds": [
        {
          "name": "Neon Lights",
          "thresholdPct": 60,
          "entityIds": ["light.cupboard_socket_1"]
        }
      ],
      "entityPresets": [
        {
          "entityId": "light.conservatory_light",
          "pinned": true,
          "targetBrightnessPct": {
            "daytime": 100,
            "evening": 100
          },
          "colorTemperatureOverrideKelvin": {
            "candlelight": 3000,
            "daylight": 3000
          }
        }
      ]
    }
  }
}
```

`colorTemperatureOverrideKelvin.sunlight` is accepted as a daytime alias for `daylight`.
