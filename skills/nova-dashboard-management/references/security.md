# Security Rules

- MCP POST calls should use a bearer token from `NOVA_DASHBOARD_MCP_TOKEN`.
- Dashboard config can require Origin validation. If blocked, use an allowed dashboard origin or local agent transport.
- Mutating tools require `confirm: true`; do not set this automatically before user approval.
- Portable config never contains tokens, passwords, private hostnames, or local filesystem paths.
- Treat `nova.zone.action` and `nova.entity.action` as live controls for a physical home.
- Tool annotations are hints only; still inspect the requested action before calling a tool.
