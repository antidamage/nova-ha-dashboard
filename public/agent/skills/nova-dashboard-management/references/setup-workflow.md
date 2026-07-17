# Setup Workflow

Agent-led deployment of Nova into a user's home:

1. **Secrets** — `nova.setup.status`. Collect any missing runtime secrets (`HA_TOKEN`, iCloud, Powershop, `NOVA_DASHBOARD_MCP_TOKEN`) and set them in the runtime environment, never in portable config.
2. **Scaffold** — `nova.config.scaffold`. It inspects live Home Assistant and returns a proposed config plus HA-side suggestions.
3. **Fix in HA first** — apply the suggested HA-side changes where possible: add `nova_illumination` / `nova_hidden` / `nova_environment` labels, assign sensors to areas, set each room area's temperature/humidity binding. These are entity-driven and need no Nova config.
4. **Patch** — apply the reviewed proposal with `nova.config.patch` (`confirm: true`), one module at a time. Use `nova.config.validate` first if unsure.
5. **Checklist** — `nova.modules.status`. Resolve any module showing unmet requirements, then re-run.
6. **Verify** — `nova.dashboard.health` and `nova.dashboard.state`.

See `config-schema.md` for the config shape and the dashboard's `docs/config-and-home-assistant.md` for what belongs in config vs Home Assistant.
