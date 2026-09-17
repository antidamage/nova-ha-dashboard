# Spec index

One spec per feature area. This index exists so an agent can find the right
one without reading the others.

A change that alters behaviour, APIs, configuration, persistence, deployment,
tests or user-visible UI revises the relevant spec in the same change. A later
plan covering ground an existing spec describes **edits that spec in place** —
git history is the revision log. Do not add dated near-duplicates.

`SPEC.md` at the repo root used to hold sections 1–33 of all of this in one
185KB file. It was dissolved into this directory on 2026-09-16 and is now an
index only; see `agent-token-footprint.md` for the reasoning and the file-size
convention that came with it.

## Start here

| Spec | Covers |
|---|---|
| [overview.md](overview.md) | What the dashboard is, runtime stack, environment variables, known constraints and non-goals |
| [maintenance-rule.md](maintenance-rule.md) | **The golden rules.** No machine-specific code, experience-mode parity, the hydration rule. Cited from source across the tree |
| [api-contract.md](api-contract.md) | Every HTTP route, its shape and its guarantees |
| [agent-token-footprint.md](agent-token-footprint.md) | File-size cap, directory convention, splitting rules — read before adding or splitting a file |

## Platform

| Spec | Covers |
|---|---|
| [configuration-model.md](configuration-model.md) | Config layering, the household package, persistence and atomic writes |
| [home-assistant-integration.md](home-assistant-integration.md) | HA client, entity registry, dashboard state, realtime events, entity control |
| [experience-modes.md](experience-modes.md) | Rich vs lite, and the parity contract every feature owes |
| [deployment-and-operations.md](deployment-and-operations.md) | Build, deploy and operational runbooks |
| [self-update-channel.md](self-update-channel.md) | Where the dashboard looks for a new version, which config layer decides it, and the host-side apply half |
| [testing.md](testing.md) | Test layers, what each one guards, and how to run them |
| [mcp-and-agent-interface.md](mcp-and-agent-interface.md) | The MCP surface the dashboard exposes to agents |
| [system-power-controls.md](system-power-controls.md) | Host power actions and the reconnect blocker |
| [product-decisions.md](product-decisions.md) | Decisions carried forward from prior work, with their reasons |

## Layout and shell

| Spec | Covers |
|---|---|
| [ui-shell.md](ui-shell.md) | The shell, header, navigation and zone model |
| [landscape-layout.md](landscape-layout.md) · [portrait-layout.md](portrait-layout.md) | Per-orientation dashboard layout |
| [advanced-fold.md](advanced-fold.md) · [header-fade.md](header-fade.md) · [panel-surface.md](panel-surface.md) | Shell details |
| [config-breadcrumb-navigation.md](config-breadcrumb-navigation.md) | Config page URL trail |
| [ios-home-screen-webapp.md](ios-home-screen-webapp.md) | Standalone iOS web-app behaviour: the status-bar strip |
| [ios-overscroll.md](ios-overscroll.md) | Page overscroll, bounce and pull-to-refresh on iOS/iPadOS |

## Controls

| Spec | Covers |
|---|---|
| [color-encoder.md](color-encoder.md) | ColorEncoder, the surface's only colour picker |
| [temperature-encoder.md](temperature-encoder.md) | The climate knob |
| [dial-preset-band.md](dial-preset-band.md) · [numeric-entry-popover.md](numeric-entry-popover.md) · [slide-switch.md](slide-switch.md) | Shared control parts |
| [ux-system9-controls.md](ux-system9-controls.md) | The System 9 control library |
| [ux-sounds.md](ux-sounds.md) | UX sound library and per-action assignment |

## Home areas

| Spec | Covers |
|---|---|
| [lighting-and-zone-control.md](lighting-and-zone-control.md) | Zone lighting model and commands |
| [zone-light-events.md](zone-light-events.md) · [lighting-tint.md](lighting-tint.md) | Lighting rules and tint |
| [climate-controls.md](climate-controls.md) | Climate cards |
| [aircon-auto-control.md](aircon-auto-control.md) | Lounge aircon Auto mode |
| [bedroom-heater-control-integrity.md](bedroom-heater-control-integrity.md) | Heater command integrity and its route gates |
| [power-meters.md](power-meters.md) | Metered power, washing machine and floating meter |
| [outside-weather-and-map.md](outside-weather-and-map.md) | Outside panel, weather and map |
| [outside-card.md](outside-card.md) · [weather-refresh.md](weather-refresh.md) | Narrower siblings of the above |
| [router-and-network-panel.md](router-and-network-panel.md) | Router and network panel |
| [quick-access-card.md](quick-access-card.md) | The one-line home card |
| [tasks-panel.md](tasks-panel.md) · [icloud-sync.md](icloud-sync.md) | Tasks and reminder sync |
| [status-orb-stack.md](status-orb-stack.md) | Status orb priority, timer and washing ETA |
| [discord-bot-module.md](discord-bot-module.md) | Discord module |

## Theme and presentation

| Spec | Covers |
|---|---|
| [theme-and-configuration-ux.md](theme-and-configuration-ux.md) | Theme model and the configuration surface |
| [design-modules.md](design-modules.md) | Switchable presentation layers |
| [module-system.md](module-system.md) | The installable module system |
| [nova-avatar.md](nova-avatar.md) | Avatar and host-load display |
| [theme-override.md](theme-override.md) · [wallpaper-background-mode.md](wallpaper-background-mode.md) · [desktop-theme-app-actions.md](desktop-theme-app-actions.md) | Per-device and desktop theming |

## Auth, kiosk and camera

| Spec | Covers |
|---|---|
| [login-surface.md](login-surface.md) · [face-auth.md](face-auth.md) | The login screen and face-released passkeys |
| [kiosk-attribution.md](kiosk-attribution.md) · [kiosk-display-rotation.md](kiosk-display-rotation.md) | Kiosk identity and display rotation |

## Not in this directory

- `PHONOSCOPE_MODULE_SPEC.md` at the repo root — the visualiser module format.
  It pins file paths, so splitting anything it names needs the spec updated
  first.
- `ARCHITECTURE.md` at the repo root — where code lives, as opposed to what it
  does.
