---
name: nova-dashboard-management
description: "Install, configure, validate, and manage a deployed Nova Home Assistant dashboard through its MCP endpoint and portable config schema. Use when an agent needs to guide a new dashboard setup, review or apply dashboard config, discover Home Assistant entities, verify deployment health, or safely manage dashboard tasks/zones/entities through Nova Dashboard MCP."
---

# Nova Dashboard Management

Use `/api/mcp` on the deployed dashboard. Inspect with `nova.setup.status` and `nova.dashboard.health`, discover entities with `nova.ha.discover`, validate config with `nova.config.validate`, and apply only after user approval with `nova.config.apply` plus `confirm: true`.

Portable config excludes secrets. Keep `HA_TOKEN`, iCloud app passwords, Powershop credentials, and `NOVA_DASHBOARD_MCP_TOKEN` in the runtime environment.

Read:

- `/agent/skills/nova-dashboard-management/references/mcp-tools.md`
- `/agent/skills/nova-dashboard-management/references/config-schema.md`
- `/agent/skills/nova-dashboard-management/references/setup-workflow.md`
- `/agent/skills/nova-dashboard-management/references/security.md`
