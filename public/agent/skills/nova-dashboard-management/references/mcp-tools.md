# MCP Tools

Read-only: `nova.config.get`, `nova.config.export`, `nova.config.schema`, `nova.config.validate`, `nova.config.scaffold`, `nova.setup.status`, `nova.dashboard.health`, `nova.dashboard.state`, `nova.modules.status`, `nova.ha.discover`, `nova.tasks.list`, `nova.tasks.listen`.

Mutating: `nova.config.apply`, `nova.config.patch`, `nova.zone.action`, `nova.entity.action`, `nova.tasks.add`, `nova.tasks.update`, `nova.tasks.remove`.

Mutating calls require explicit user approval and `confirm: true`.

## Agent-led deployment tools

- `nova.config.scaffold` — inspect live Home Assistant and return a proposed config plus HA-side suggestions (which switches to label `nova_illumination`, which area sensor bindings to set). Start here; it does the discovery for you.
- `nova.config.patch` — deep-merge a partial config onto the current one (`{ patch: {...}, confirm: true }`). Configure one module at a time instead of sending the whole document with `nova.config.apply`.
- `nova.modules.status` — list dashboard modules, whether each is active for this home, and unmet HA requirements. Use it as the deploy checklist and re-run after each change.
- `nova.ha.discover` now returns `area_id`, `entity_category`, `labels`, plus an `areas` list (with `temperature_entity_id`/`humidity_entity_id` bindings) and defined `labels`. Use this to decide HA-side fixes.

## Entity-driven first

Prefer fixing classification in Home Assistant over config overrides: add a `nova_illumination` / `nova_hidden` / `nova_environment` label, assign a sensor to an area, set an area's temperature/humidity binding, or set `device_class`. Nova picks these up live. Only use `homeAssistant.classification.*` id lists when HA metadata cannot be corrected. See `config-schema.md` and the dashboard's `docs/config-and-home-assistant.md`.
