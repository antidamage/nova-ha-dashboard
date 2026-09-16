# Nova HA Dashboard Specification

This file used to be the whole specification: 33 sections, 3,474 lines, 185KB.
It was dissolved into `specs/` on 2026-09-16.

**The specification now lives in [`specs/`](specs/README.md), one file per
feature area.** Start at [`specs/README.md`](specs/README.md).

## Why

The dashboard is read by agents, not by a person. A 185KB spec meant that any
question about any area cost ~50K tokens to answer, so it was either read in
full or — more often — skipped. Per-area files cost an agent one area.

`specs/agent-token-footprint.md` has the reasoning, the file-size convention
that came with it, and the measurements.

## Where the sections went

| Was | Now |
|---|---|
| §1 Purpose, §3 Runtime Stack, §4 Environment, §29 Known Constraints | [`specs/overview.md`](specs/overview.md) |
| **§2 Maintenance Rule** | [`specs/maintenance-rule.md`](specs/maintenance-rule.md) |
| §5 Configuration Model, §6 Persistence | [`specs/configuration-model.md`](specs/configuration-model.md) |
| §7 HA Integration, §8 Dashboard State, §9 Realtime Events, §13 Entity Control | [`specs/home-assistant-integration.md`](specs/home-assistant-integration.md) |
| §10 UI Shell, §11 Navigation and Zones | [`specs/ui-shell.md`](specs/ui-shell.md) |
| §12 Lighting and Zone Control | [`specs/lighting-and-zone-control.md`](specs/lighting-and-zone-control.md) |
| §14 Climate Controls | [`specs/climate-controls.md`](specs/climate-controls.md) |
| §15 Dashboard Auto Aircon | [`specs/aircon-auto-control.md`](specs/aircon-auto-control.md) |
| §16 Outside, Weather, and Map | [`specs/outside-weather-and-map.md`](specs/outside-weather-and-map.md) |
| §17 Router and Network Panel | [`specs/router-and-network-panel.md`](specs/router-and-network-panel.md) |
| §18 Power Monitoring | [`specs/power-meters.md`](specs/power-meters.md) |
| §19 Tasks | [`specs/tasks-panel.md`](specs/tasks-panel.md) |
| §20 iCloud Sync | [`specs/icloud-sync.md`](specs/icloud-sync.md) |
| §21 Theme and Configuration UX | [`specs/theme-and-configuration-ux.md`](specs/theme-and-configuration-ux.md) |
| §22 Nova Avatar and Host Load | [`specs/nova-avatar.md`](specs/nova-avatar.md) |
| §23 Status Orb Modules | [`specs/status-orb-stack.md`](specs/status-orb-stack.md) |
| §24 API Contract | [`specs/api-contract.md`](specs/api-contract.md) |
| §25 MCP and Agent Interface | [`specs/mcp-and-agent-interface.md`](specs/mcp-and-agent-interface.md) |
| §26 Testing | [`specs/testing.md`](specs/testing.md) |
| §27 Deployment and Operations | [`specs/deployment-and-operations.md`](specs/deployment-and-operations.md) |
| §28 Product Decisions From Prior Work | [`specs/product-decisions.md`](specs/product-decisions.md) |
| §30 System Power Controls | [`specs/system-power-controls.md`](specs/system-power-controls.md) |
| §31 Experience Modes | [`specs/experience-modes.md`](specs/experience-modes.md) |
| §32 Dashboard Modules | [`specs/module-system.md`](specs/module-system.md) |
| §33 Design Modules | [`specs/design-modules.md`](specs/design-modules.md) |

Sections 15, 18, 19, 23, 32 and 33 were merged into per-area specs that
already covered the same ground rather than becoming new files.

Do not restore content here. Edit the per-area spec instead.
