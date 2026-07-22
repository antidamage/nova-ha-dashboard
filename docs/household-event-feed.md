# Household event feed

Nova Dashboard owns the household-facing event source used by the Voice durable
agent. The feed is separate from the browser SSE endpoint at `/api/events`.

`GET /api/agent/events?after=<cursor>&limit=<count>` requires the same bearer
secret as authenticated MCP calls. It returns strict version-1 events in
monotonic cursor order. `NOVA_DASHBOARD_MCP_TOKEN` must be configured; the
endpoint fails closed when it is absent. `POST /api/agent/events` uses the same
authentication and accepts already normalized events from trusted household
services, including agent-task producers.

Events are retained in an append-only JSONL spool at
`data/household-events.jsonl`, or the path selected by
`NOVA_DASHBOARD_HOUSEHOLD_EVENTS`. The process keeps a bounded in-memory index
and compacts the spool only when the 20,000-event retention bound is crossed.
Repeated deduplication keys return the original cursor instead of appending a
second event. A consumer whose cursor predates retention receives
`resetRequired`, the first retained cursor, and the retained batch.

The Dashboard normalizes Home Assistant `state_changed` messages into:

- `ha_state` for ordinary entity changes;
- `occupancy` for people, trackers, and occupancy/presence sensors;
- `device_health` when an entity becomes unavailable or recovers;
- `weather` for weather entities;
- `energy` for power/energy sensors.

Calendar and reminder mutations produce deduplicated snapshots. The feed also
accepts `agent_task` events from an authenticated producer. Payloads contain
normalized state needed by the agent and never Home Assistant credentials.

The first authenticated Voice read starts the HA subscription and task-source
pollers for the lifetime of the Dashboard process, so event capture does not
depend on a browser page remaining open.
