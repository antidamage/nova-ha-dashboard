# Nova HA Dashboard

The control surface for Nova. A Next.js app served on the local network,
presenting Home Assistant as room-level zones for touch screens, kiosks and
desktops in both portrait and landscape. It also acts as the configuration and
API hub the other Nova components read from.

**[Live demo](https://antidamage.github.io/nova-ha-dashboard/config/)** — runs in
the browser against fixture data, no Home Assistant required.

## Where it fits

| Component | Interface |
|---|---|
| Wall tablets, kiosk browsers, phones | The web UI |
| [Nova Apple TV Dashboard](https://github.com/antidamage/nova-apple-tv) | Reads `/api/*`, sends actions to `/api/zone`, consumes `/api/events` |
| [Nova Voice](https://github.com/antidamage/nova-voice) | Pulls the `GET /api/voice` contract and an authenticated household-event feed |
| [Nova Visualiser](https://github.com/antidamage/nova-visualiser) | Subscribes to config over SSE; publishes house-party lighting frames back |
| Home Assistant | Source of entity state; all device commands go through it |
| Camera host | Serves `/api/camera/outside/*`, or proxies a standalone capture service |
| Coding agents and scripts | `POST /api/mcp` (MCP-compatible JSON-RPC) |

## What it does

**Zone control.** Lights, switches, climate and fans are grouped by room in a
configured order, with zone-level actions rather than per-entity controls.
Broad actions such as "everything off" honour a configured exclusion list, so
devices like the outside light are not caught by them.

**Live colour and brightness.** Hue selection and brightness controls use
separate preview and commit boundaries, so dragging through a spectrum produces
one command rather than a stream of them.

**Multi-client state.** Polling and a shared event stream keep several open
clients current with each other.

**Portable configuration.** The whole dashboard is described by a versioned JSON
document with a published JSON Schema, exportable and importable from `/config`.
Exports omit tokens, passwords, machine-local paths, speaker embeddings and
private camera hosts.

**Household event feed.** Normalized events are published on an authenticated,
persistent cursor feed for Nova Voice.

**MCP surface.** Config export/validation/apply, setup status, Home Assistant
discovery, dashboard health and state, zone and entity control, and task
management. Mutating tools require `confirm: true`.

**Self-update.** The live install updates from GitHub with out-of-line builds,
health-gated switching and automatic rollback.

## Install

Requires Node.js and a reachable Home Assistant instance.

```powershell
npm install
npm run dev            # development server
npm run build          # production build
npm run start          # production server
npm run test           # test suite
```

Set your Home Assistant connection before first run:

| Variable | Default | Purpose |
|---|---|---|
| `HA_URL` | `http://127.0.0.1:8123` | Home Assistant base URL |
| `HA_TOKEN` | — | Long-lived access token |
| `NOVA_DASHBOARD_CONFIG` | `data/dashboard-config.json` | Runtime config path |
| `NOVA_DASHBOARD_MCP_TOKEN` | — | Bearer token for MCP and the server-to-server event feed |
| `NOVA_DASHBOARD_HOUSEHOLD_EVENTS` | `data/household-events.jsonl` | Normalized event spool |
| `NOVA_VOICE_IRIDIUM_URL` | — | Nova Voice base URL |
| `ICLOUD_USERNAME` / `ICLOUD_APP_PASSWORD` | — | Optional CalDAV calendar/reminder sync |
| `ICLOUD_CALENDARS` / `ICLOUD_REMINDERS` | — | Optional comma-separated allow-lists |
| `ICLOUD_SYNC_DAYS` | `7` | Forward sync window |

Then edit `config/common.json` (Home Assistant, map and power values) and
`config/tasks.json` (task and iCloud list behaviour). Everything else is managed
from `/config` in the running app.

### Optional: mutual-TLS identity for Nova Voice

Voice preference changes signal Iridium over mTLS. Issue the identity there:

```sh
sudo /opt/nova-voice/current/ops/issue-satellite-identity.sh nova-dashboard /tmp/nova-dashboard-identity
```

Install the three files at `data/nova-voice-tls/{ca.crt,client.crt,client.key}`
(`0600` on the key, `0644` on the certificates). The path is fixed so runtime
secrets never reach a portable config export.

## Configuration

Open `/config` to export the active config, download its JSON Schema, dry-run an
import, apply one, and see which runtime secrets are still missing.

```
GET  /api/config           current portable config + setup status
PUT  /api/config           validate and apply a config
GET  /api/config/schema    JSON Schema 2020-12 export
POST /api/config/validate  dry-run an import
GET  /api/config/client    non-secret config for browser surfaces
```

Exports deliberately omit tokens, passwords, machine-local paths, speaker
embeddings and private camera hosts — an export is safe to share or commit.

To refresh repository defaults from a running installation:

```powershell
npm run snapshot:defaults -- http://nova.local "Human Revolution"
```

## Agent and MCP surface

`POST /api/mcp` speaks MCP-compatible JSON-RPC; `GET /api/mcp` advertises the
available tools, resources and prompts. POSTs require
`Authorization: Bearer <NOVA_DASHBOARD_MCP_TOKEN>` when auth is enabled.
`/api/tasks/mcp` remains as a compatibility shim.

Agent materials ship as `skills/nova-dashboard-management/` (a Codex skill
package) and, once deployed, at `/agent/skills/nova-dashboard-management/SKILL.md`
with metadata at `/agent/nova-dashboard-mcp.json`. Validate the package with
`npm run package:skills`.

## Building the public demo

```powershell
npm run build:demo
npm run build:demo -- http://127.0.0.1:4174/    # against a local provider
```

The demo runs on GitHub Pages against
[nova-dummy-data-provider](https://github.com/antidamage/nova-dummy-data-provider). It has no microphone,
speech models, household memory or acting agent, so the voice, satellite,
training and agent panels are preview-only there.

## Deployment

The live install runs under `/opt/nova-ha-dashboard`, managed by
`nova-ha-dashboard.service`. It self-updates from GitHub with health-gated
switching and automatic rollback — see [`ops/README.md`](ops/README.md).

Camera behaviour depends on the deployment's role: a camera *consumer* sets
`dashboard.camera.outside.ingestionEnabled` to false and points `videoHostUrl` at
the capture host. See [`docs/camera-dvr.md`](docs/camera-dvr.md).

## Private deployment reference

Hostnames, LAN addresses and account names are deliberately absent from this
repository. Documentation refers to them as `PRIVATEREF.md#<section>`; that file
is git-ignored and lives only on household machines. Copy your own values into a
local `PRIVATEREF.md` when deploying.
