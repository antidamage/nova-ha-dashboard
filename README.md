# Nova HA Dashboard

Nova HA Dashboard is a local Home Assistant control surface for a smart-home setup. It is a Next.js app served on the local network, designed for desktop, wall-mounted and touch-screen use in both portrait and landscape orientations.

View a live demo: https://antidamage.github.io/nova-ha-dashboard/

The dashboard is configured through a portable, versioned JSON schema. Shipped defaults are assembled from `config/dashboard-config.default.json`, first-time setup values in `config/common.json`, task setup in `config/tasks.json`, and non-secret UI defaults in `config/dashboard-preferences.default.json`; runtime imports live under `data/dashboard-config.json` by default and are preserved across Nova deployments.

## What It Does

- Reads rooms, devices, entity state, brightness, and colour information from Home Assistant.
- Provides zone-level controls for lights, switches, climate, fans, and related entities.
- Shows a cyber-styled portrait/landscape dashboard for daily use.
- Includes live colour selection, brightness control, router status, and a digital clock.
- Excludes special-case devices, such as the outside light, from broad inside/everything actions.
- Polls and refreshes local state so multiple open dashboard clients stay reasonably current.
- Publishes an authenticated, persistent cursor feed of normalized household events for Nova Voice.

## Local Development

Install dependencies:

```powershell
npm install
```

Run the development server:

```powershell
npm run dev
```

Build for production:

```powershell
npm run build
```

Build the static public demo against the published provider (or pass a local
provider URL while testing fixture changes):

```powershell
npm run build:demo
npm run build:demo -- http://127.0.0.1:4174/
```

Run tests:

```powershell
npm run test
```

Validate the packaged agent skill:

```powershell
npm run package:skills
```

## Configuration

Open `/config` to export the active portable config, download the JSON Schema, validate a draft import, import a config, and review missing runtime secrets.
For first-time setup, edit `config/common.json` for common Home Assistant/map/power values and `config/tasks.json` for task and iCloud task-list behavior. Settings managed by `/config`, such as theme, Status Orb settings, and climate timer step, are kept in the portable runtime config rather than the setup-only files.

To refresh all repository-safe defaults from a running Nova installation:

```powershell
npm run snapshot:defaults -- http://nova.local "Human Revolution"
```

The snapshot intentionally excludes secrets, machine-local paths, personal
speaker embeddings, camera ingestion, and private camera hosts. The public demo
can display the exported voice, satellite, training, and agent settings, but
those controls are preview-only because GitHub Pages has no microphone, speech
models, household memory, or acting voice agent.

Configuration APIs:

- `GET /api/config`: current portable config plus setup status.
- `PUT /api/config`: validate and apply a portable config.
- `GET /api/config/schema`: JSON Schema 2020-12 export.
- `POST /api/config/validate`: dry-run an import.
- `GET /api/config/client`: non-secret client config for browser surfaces.

Portable exports intentionally exclude tokens, passwords, private runtime paths, and other machine-local secrets.

Start a production server:

```powershell
npm run start
```

## Environment

The app expects Home Assistant connection settings from environment variables:

- `HA_URL`: Home Assistant base URL, defaulting to `http://127.0.0.1:8123`.
- `HA_TOKEN`: a Home Assistant long-lived access token.
- `NOVA_DASHBOARD_CONFIG`: optional runtime config path, defaulting to `data/dashboard-config.json`.
- `NOVA_DASHBOARD_MCP_TOKEN`: bearer token for MCP calls and the server-to-server household event feed.
- `NOVA_DASHBOARD_HOUSEHOLD_EVENTS`: optional normalized event-spool path, defaulting to `data/household-events.jsonl`.
- `NOVA_VOICE_IRIDIUM_URL`: Nova Voice base URL (deployed value: see `PRIVATEREF.md#1.3`).
- `ICLOUD_USERNAME`: optional Apple ID email for CalDAV Calendar/Reminders sync.
- `ICLOUD_APP_PASSWORD`: optional Apple app-specific password for CalDAV sync.
- `ICLOUD_CALENDARS`: optional comma-separated allow-list of iCloud calendar names.
- `ICLOUD_REMINDERS`: optional comma-separated allow-list of iCloud reminder list names.
- `ICLOUD_SYNC_DAYS`: optional forward sync window in days, defaulting to `7`.

The mTLS identity Nova uses to signal Iridium after a voice preference change
is read from `data/nova-voice-tls/{ca.crt,client.crt,client.key}`. Keeping this
location fixed prevents runtime secrets from entering portable config exports.
Issue it on Iridium with
`sudo /opt/nova-voice/current/ops/issue-satellite-identity.sh nova-dashboard /tmp/nova-dashboard-identity`,
then securely install those three files at that fixed path on Nova (mode `0600`
for `client.key`; `0644` for the certificates).

Production secrets live on Nova, not in this repository.

The dashboard also stores small global runtime preferences, such as the last aircon settings chosen from Nova, under `data/`. These files are ignored by Git.

## MCP and Agent Setup

The dashboard exposes a general MCP-compatible JSON-RPC endpoint at `POST /api/mcp`. `GET /api/mcp` returns the advertised tools, resources, prompts, and endpoint metadata. The old task endpoint at `/api/tasks/mcp` remains as a compatibility shim.

MCP tools cover config export/validation/apply, setup status, Home Assistant discovery, dashboard health/state, zone/entity control, and task management. Mutating tools require `confirm: true`, and MCP POST calls require `Authorization: Bearer <NOVA_DASHBOARD_MCP_TOKEN>` when auth is enabled.

Agent materials ship in two forms:

- `skills/nova-dashboard-management/`: Codex skill package for repo/install agents.
- `public/agent/nova-dashboard-mcp.json` and `/agent/skills/nova-dashboard-management/SKILL.md`: deployed metadata and skill instructions for other agents.

## Deployment Notes

The live deployment runs on Nova under `/opt/nova-ha-dashboard` and is managed by `nova-ha-dashboard.service`. Typical changes are built locally first, copied to Nova, rebuilt there, and then the service is restarted.

The live Nova VM is a camera consumer only: shared config keeps `dashboard.camera.outside.ingestionEnabled` false and sets `videoHostUrl` to the camera host (see `PRIVATEREF.md#1.4`). Nocturnium runs the original ffmpeg/VAAPI DVR inside `nova-ha-dashboard.service`; `ops/nocturnium-camera-proxy.py` exposes its `/api/camera/...` routes as the CORS-enabled standalone `/camera/...` surface embedded by browsers and Apple TV. When the MS2109 path is absent, the recorder serves the retained synthetic live clock until the USB grabber is connected and the recorder is restarted. See [docs/camera-dvr.md](docs/camera-dvr.md).

Generated files, build output, browser artifacts, local environment files, and dependencies are ignored by Git.

## Private deployment reference

Concrete household details (hostnames, LAN addresses, account names, key names)
are deliberately absent from this repository. Documentation refers to them as
`PRIVATEREF.md#<section>`; that file is git-ignored and lives only on household
machines. Copy your own values into a local `PRIVATEREF.md` when deploying.
