# Purpose, stack and constraints

## Purpose

Nova HA Dashboard is a local-first Next.js control surface for the Nova Home
Assistant installation. It is designed for a wall, tablet, desktop, and touch
dashboard experience that controls and observes:

- Home Assistant lights, illumination switches, general switches, climate
  devices, fans, covers, humidifiers, and selected sensors.
- Room and whole-home lighting scenes, brightness, and color.
- Dashboard-managed climate behavior for lounge air conditioning and panel
  heaters.
- Weather, sun state, rain radar, and a cyber-styled local map.
- Router/network throughput.
- Electricity usage, cost estimates, Powershop account history, and modeled
  base loads.
- Local tasks, iCloud Calendar events, iCloud Reminders, alerts, and audio.
- A live outside CCTV feed with a rolling two-hour DVR and retained synthetic
  signal-test fallback.
- Runtime configuration, theme editing, MCP/agent access, and setup status.
- Nova host load visualization through the animated Nova avatar, including a
  GymMaster-backed gym visit age counter.

The dashboard is intended to run on the Nova host, with the
application deployed under `/opt/nova-ha-dashboard` and served by the
`nova-ha-dashboard.service` systemd unit. Nova is the sole dashboard and Home
Assistant host (hostname/address/user: see `PRIVATEREF.md#1.1` and `#2.1`);
Iridium is a
separate offline machine and must not be treated as a Nova alias or fallback.
Home Assistant runs locally in a container on port `8123`.

## Runtime Stack

- Framework: Next.js App Router, React, TypeScript.
- Styling: CSS modules/global CSS plus runtime CSS variables for device theme.
- UI dependencies: `lucide-react`, Radix Slider and Tooltip.
- Map: `maplibre-gl`.
- Image processing: `sharp` for radar and satellite tile processing.
- Calendar/reminders: `tsdav` and `ical.js`.
- Realtime: server-sent events from `/api/events`.
- Tests: Vitest, Testing Library, jsdom, and a dedicated Node TypeScript
  aircon test runner.
- Package manager: npm with `package-lock.json`.

Project scripts:

- `npm run dev`: start Next dev server on `0.0.0.0`.
- `npm run build`: production Next build.
- `npm run start`: production Next server.
- `npm run package:skills`: validate and publish agent skill assets under
  `public/agent`.
- `npm run test:unit`: Vitest suite.
- `npm run test:coverage`: Vitest suite with v8 coverage (report under
  `coverage/`).
- `npm run test:aircon`: compile and run the aircon control test file through
  the dedicated TypeScript project.
- `npm run test:e2e`: Playwright end-to-end suite against the demo build
  (also runnable from the repo root via `./run-e2e.ps1`).
- `npm test`: unit tests, aircon tests, and skill packaging.

## Environment

The default environment template is `.env.example`.

Required or primary variables:

- `HA_URL`: Home Assistant base URL. Defaults in code to
  `http://127.0.0.1:8123`.
- `HA_TOKEN`: Home Assistant long-lived access token. Required for HA API
  calls.
- `NOVA_DASHBOARD_CONFIG`: optional runtime config path. Defaults to
  `data/dashboard-config.json`.
- `NOVA_DASHBOARD_MCP_TOKEN`: bearer token required when MCP auth is enabled.
- `NEXT_PUBLIC_MAP_CENTER`: optional `lat,lng` map center compatibility
  override.

iCloud variables:

- `ICLOUD_USERNAME`
- `ICLOUD_APP_PASSWORD`
- `ICLOUD_CALENDARS`
- `ICLOUD_REMINDERS`
- `ICLOUD_SYNC_DAYS`

Powershop variables:

- `POWERSHOP_EMAIL`
- `POWERSHOP_PASSWORD`
- `POWERSHOP_DATA_DIR`

GymMaster variables:

- `GYMMASTER_EMAIL`: AllFit/GymMaster member portal login email.
- `GYMMASTER_PASSWORD`: AllFit/GymMaster member portal password.
- `GYMMASTER_DATA_DIR`: optional GymMaster scrape data directory.
- `GYMMASTER_DASHBOARD_URL`: optional dashboard origin for the scraper to
  update `/api/watchface`. The direct Node script defaults to
  `http://127.0.0.1:3000`; the production runner sets a Nova-specific default.
- `GYMMASTER_PORTAL_URL`: optional visit-history URL override, defaulting to
  the AllFit GymMaster visit history page.

Additional runtime paths used by code:

- `NOVA_DASHBOARD_PREFERENCES`: optional preferences file path.
- `NOVA_DASHBOARD_TASKS`: optional tasks file path.
- `NOVA_DASHBOARD_POWER_DATA`: optional power data directory.
- `NOVA_DASHBOARD_POWERSHOP_DATA`: optional Powershop usage data directory.
- `NOVA_DASHBOARD_BUILD_ID`: build ID fallback when `.next/BUILD_ID` is absent.

## Known Constraints and Non-Goals

- The dashboard is optimized for a trusted local network deployment.
- Home Assistant token management is external to the app.
- Config files intentionally do not store secrets. The one secret set from the
  UI rather than the environment — the theme-change notification URL — lives in
  its own 0600 `data/dashboard-secrets.json`, outside config, so that a config
  export cannot carry it and a config import cannot overwrite it.
- iCloud mirrored tasks are read-only inside the dashboard.
- iCloud recurrence exception handling is limited by current implementation.
- The task CSV parser is a simple project-specific parser, not a full RFC CSV
  implementation.
- Power usage is an estimate when explicit power sensors are unavailable.
- Hardcoded Powershop rate tables need periodic review when plans/prices
  change.
- Radar and satellite features depend on external tile services.
- GPU load requires `nvidia-smi`; hosts without it report no GPU contribution.
- Linux `/proc` load readers are host-specific; non-Linux environments may
  return partial load data.
