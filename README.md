# Nova HA Dashboard

Nova is a control surface for managing your household; from lights and climate, to personal reminders, entertainment and security.

Nova is open-source and is intended to be extensible by agent, by anyone.

A core focus of this project is presentation. While Home Assistant provides the smart-home transport layer, Nova gives you a way to shape that experience into something that you'll want to use every day.

**[Live demo](https://antidamage.github.io/nova-ha-dashboard/)**

## Support this project

I am an out-of-work developer. If you would like to accelerate work on this project, please consider making a donation to support it by sending me funds via Paypal to paypal@skull.co.nz. A one-off or monthly contribution of $20USD is ideal, but any amount helps!

## Roadmap

The project is nearly at MVP, but more work remains to be done on installation and extensibility via agent, MCP for management via agent, and generally better alignment with open-source practices in terms of commit flow, PRs, releases, security reviews, etc. These latter tasks from installation onwards will be the final stages of the project required to reach MVP, and are the key elements for making it easy and cheap for agents to install.

Beyond MVP I hope to take on user requests and PRs in order to continue developing its capabilities, features and presentation.

The ultimate goal is to have a control surface for interacting with an agent for the purposes of running of a household. A tool that can grow with other advancements, particularly home robotics.

If you love this project, please support it! 💙

## Security

This project is not yet secure. Use it at your own risk, and most definitely hide any installations behind a secure network.

## Development contributions

We're not set up for PRs yet, and the code in in flux as it is 100% written by agents. A key stake is that outside contributions aren't meaninglessly backed out by a clumsy agent action. The project will be adopting a more recognised workflow in the future to support this, and at that time contributions will be welcomed and encouraged.

## Sibling repositories

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

## Human install

Set your agent to planning mode and feed it the following prompt (preferably set to high effort):

```prompt
You are an expert developer.
#The goal
- Install, configure and test Nova: https://github.com/antidamage/nova-ha-dashboard
#Execution
- Never transmit information about the user, their network topology or household to any third-party, service or other provider without a good reason for doing so, and never do so without the user's express consent. Even if the disclosure is blocking, privacy and safety issues must be evaluated and discussed with the user before disclosing information.
- Interview the user to determine their installation and configuration requirements. Pay particular attention to network and household topology.
- Create a task list to work to, and keep the user informed as to its progress, including that of sub-agents and reviewers.
- Run a gauntlet to complete this installation. Spawn additional sub-agents to adversarially review completed tasks. A task is not complete until it passes review.
- Install and configure any missing upstream dependencies, making sure to confirm with the user which hardware each service should be installed on.
- Install Tailscale if required for remote and secure access, as well as fixed addressing. Instruct the user on how to complete Tailscale registration and personalisation, and wait for them to complete these steps and check the result. Provide the user with any assistance necessary to complete this step correctly, and be patient and supportive.
- Install Home Assistant if it is not present on the network, and configure it.
- Scan the network for smart devices that should be added to nova: lighting, climate devices, entertainment devices and security cameras.
- Where possible and reasonable install services to containers. Ask the user what container they prefer, but you can default to Docker or whatever is most suitable for each environment.
- Minimise container memory usage. Be sure to measure memory usage and adjust reserved memory values as a final post-installation step.
- Pay particular attention to each environment (e.g. Windows, Linux, MacOS) you are installing in, and follow best practices for that environment.
- Ensure that Nova and the appropriate upstream services start at boot or are robust and can auto-self-restore if stopped.
- Believe the user but verify. Until you definitively find otherwise, they are the experts on their network topology and configuration.
- Run a gauntlet and conduct a security and privacy review of anything we configured. You may ask the user how thorough this review needs to be, but the result MUST pass review and meet minimum privacy requirements or have user waivers of such. However do not excessively modify the user's network topology, the scope of this task is limited to installation and configuration of Nova and its upstream services.
- Bring Nova and all services online and pause to allow for user evaluation. Direct them to the correct addresses and summarise what features were installed and should go through acceptance.
- Briefly summarise installation steps and topology in a report, but pay particular attention to recording any security or privacy waivers given, then save it to the user's downloads folder and inform the user of its location and advise them to review it.
#Completion
- Your work is done when Nova is fully installed, all execution steps have been completed, Nova has passed smoke-testing and has passed user-acceptance.
- All smart-home devices found on the network must be connected via Home Assistant, configured and represented in Nova's front-end.
- User acceptance is the ultimate goal, be sure to welcome additional runs of this prompt to further improve the user experience while using Nova.
# Definitions
- Gauntlet: fan out sub-agents to complete tasks. Spawn further sub-agents to adversarially review work done. A task is finished when it can pass review.
```

Implement the plan in a lower-end model with low effort and then review the installation steps and results with a better model and higher effort.

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
