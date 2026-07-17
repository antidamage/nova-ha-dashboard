# Config Schema

Use `/api/config/schema` or MCP resource `nova://dashboard/config/schema`.

Portable groups: `homeAssistant`, `dashboard`, `mapWeather`, `power`, `tasks`, `theme`, `mcp`.

`dashboard.lighting.intensityThresholds` can assign HA entity IDs to a minimum intensity before those devices turn on.

Secrets stay in env vars, not exported config.
