# MCP Tools

Endpoint: `/api/mcp`

Use JSON-RPC 2.0 over HTTP POST. Include `Authorization: Bearer <NOVA_DASHBOARD_MCP_TOKEN>` when dashboard config requires bearer auth.

Core read-only tools:

- `nova.config.get`: active portable config.
- `nova.config.export`: same portable config, intended for backup/export.
- `nova.config.schema`: JSON Schema for config imports.
- `nova.config.validate`: dry-run config import.
- `nova.setup.status`: secret/setup checklist with booleans only.
- `nova.dashboard.health`: config, HA, task, and setup health.
- `nova.dashboard.state`: current dashboard state.
- `nova.ha.discover`: HA entity discovery, optional `domains`, `search`, `limit`.
- `nova.tasks.list`: task list.
- `nova.tasks.listen`: task SSE endpoint details.

Mutating tools require user approval and `confirm: true`:

- `nova.config.apply`
- `nova.zone.action`
- `nova.entity.action`
- `nova.tasks.add`
- `nova.tasks.update`
- `nova.tasks.remove`

Resources:

- `nova://dashboard/config/schema`
- `nova://dashboard/config/current`
- `nova://dashboard/setup/checklist`
- `nova://dashboard/home-assistant/entities`

Prompts:

- `nova.setup.wizard`
- `nova.config.review`
- `nova.deployment.check`
