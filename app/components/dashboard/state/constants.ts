"use client";

// Abort rather than hang: over HTTP/1.1 the browser caps concurrent connections
// per origin (~6), and a snapshot request that never settles (server mid-boot,
// contended box) occupies one of those slots forever. Enough zombies and every
// later request — new polls, /api/update health checks, even the SSE reconnect —
// queues behind them with no recovery path. The 2026-07-11 kiosk soft outage
// ("Loading zone controls" for 70+ minutes while the server was healthy) was
// this. A hard timeout turns a hung request into an ordinary retryable error.
export const SNAPSHOT_FETCH_TIMEOUT_MS = 15_000;

// Every user command holds the poll/SSE cooldown (see the POLLING COOLDOWN
// CONTRACT in state.ts) for at least six seconds after the control is used, so a
// snapshot that still carries HA's pre-change value cannot snap the control back
// (the "rubber-band"). Slower devices (Tuya climate, cloud-bridged switches) can
// take several seconds to echo the new state; the previous 2s/5s holds expired
// before that and let the reconcile poll clobber the optimistic value. Lights
// already hold 10s (LIGHT_COMMAND_POLL_HOLD_MS). The reconcile poll fires at
// hold + 100ms, so it lands just after the window — the first snapshot we accept
// is the one that already reflects the command.
export const ENTITY_COMMAND_HOLD_MS = 6000;
export const ENTITY_COMMAND_POLL_DELAYS_MS = [ENTITY_COMMAND_HOLD_MS + 100] as const;
export const CLIMATE_COMMAND_HOLD_MS = 6000;
export const CLIMATE_COMMAND_POLL_DELAYS_MS = [CLIMATE_COMMAND_HOLD_MS + 100] as const;
