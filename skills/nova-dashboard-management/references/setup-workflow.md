# Setup Workflow

1. Check `nova.setup.status`.
2. Ask the installer to set missing runtime secrets outside portable config.
3. Call `nova.ha.discover` with domains such as `light`, `switch`, `climate`, `sensor`, and `weather`.
4. Build or revise portable config using discovered entity IDs and area names.
5. Validate with `nova.config.validate`.
6. Apply with `nova.config.apply` and `confirm: true` after user approval.
7. Verify with `nova.dashboard.health`.
8. Read `nova.dashboard.state` and confirm expected zones, weather, router, tasks, and power surfaces are present.

For migrations, export the old config with `nova.config.export`, import it into the new dashboard, then redo secret setup locally.
