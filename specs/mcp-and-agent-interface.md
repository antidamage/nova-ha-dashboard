# MCP and Agent Interface

`lib/mcp-dashboard.ts` implements the local MCP server contract.

Server:

- Name: `nova-dashboard`.
- Version: `1.0.0`.
- Endpoint: `/api/mcp`.
- Public metadata: `public/agent/nova-dashboard-mcp.json`.

Security:

- MCP can be enabled/disabled through config.
- Origins are checked against configured allowed origins.
- Requests without an Origin are allowed.
- Bearer auth is required when configured.
- If bearer auth is required and `NOVA_DASHBOARD_MCP_TOKEN` is missing, POST
  requests fail with service unavailable.
- Mutating tools require mutations to be enabled.
- When configured, mutating tools require `confirm: true`.

Supported JSON-RPC methods:

- `initialize`
- `ping`
- `tools/list`
- `tools/call`
- `resources/list`
- `resources/read`
- `prompts/list`
- `prompts/get`

Batch requests and notifications are supported.

Tools:

- `nova.config.get`
- `nova.config.export`
- `nova.config.schema`
- `nova.config.validate`
- `nova.config.apply`
- `nova.setup.status`
- `nova.dashboard.health`
- `nova.dashboard.state`
- `nova.ha.discover`
- `nova.zone.action`
- `nova.entity.action`
- `nova.tasks.list`
- `nova.tasks.listen`
- `nova.tasks.add`
- `nova.tasks.update`
- `nova.tasks.remove`

Resources:

- Current config.
- Config schema.
- Setup checklist.
- Home Assistant entities.

Prompts:

- Setup wizard.
- Config review.
- Deployment check.

Agent skill packaging:

- Source skill: `skills/nova-dashboard-management`.
- Public packaged copy: `public/agent/skills/nova-dashboard-management`.
- Packaging script validates skill frontmatter and referenced files.
- The skill instructs agents to inspect first, validate second, and mutate only
  after explicit confirmation.
