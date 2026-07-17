---
name: nova-dashboard-management
description: "Install, configure, validate, and manage a deployed Nova Home Assistant dashboard through its MCP endpoint and portable config schema. Use when an agent needs to guide a new dashboard setup, review or apply dashboard config, discover Home Assistant entities, verify deployment health, or safely manage dashboard tasks/zones/entities through Nova Dashboard MCP."
---

# Nova Dashboard Management

Use the deployed dashboard MCP endpoint as the source of truth. Inspect first, validate second, mutate only after explicit user confirmation.

Default endpoint:

```text
/api/mcp
```

If the user gives a dashboard origin, connect to:

```text
https://<dashboard-origin>/api/mcp
```

Read these references as needed:

- `references/mcp-tools.md`: tool/resource/prompt map and call patterns.
- `references/config-schema.md`: portable config groups and import/export rules.
- `references/setup-workflow.md`: first-install and migration workflow.
- `references/security.md`: secrets, auth, Origin, and mutation rules.

## Workflow

1. Call `nova.setup.status` and `nova.dashboard.health`.
2. If Home Assistant is reachable, call `nova.ha.discover` for relevant domains before proposing config.
3. Read `nova://dashboard/config/schema` or call `nova.config.schema` before generating or editing config.
4. Keep tokens, passwords, hostnames, and machine-local paths outside portable config. Ask the user or installer agent to set them in the runtime environment.
5. Validate with `nova.config.validate`.
6. Apply with `nova.config.apply` only when the user has approved the exact config and pass `confirm: true`.
7. Verify with `nova.dashboard.health` and `nova.dashboard.state`.

## Non-Negotiables

- Never put `HA_TOKEN`, iCloud app passwords, Powershop credentials, or MCP bearer tokens in exported config.
- Prefer config import/export over editing deployed source code.
- Use `confirm: true` only after the user has approved the mutation.
- Treat zone/entity control tools as live smart-home actions.
- If MCP auth is enabled and `NOVA_DASHBOARD_MCP_TOKEN` is missing, ask the deployer to set it before trying POST calls.
