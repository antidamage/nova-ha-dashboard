// Dashboard event stream timings. The poll, heartbeat, weather and adaptive
// lighting intervals are fallbacks: ./poller prefers dashboard.timing from the
// config when it is set.

export const DASHBOARD_BUILD_EVENT_POLL_MS = 5000;
export const DASHBOARD_EVENT_POLL_MS = 5000;
export const DASHBOARD_EVENT_HEARTBEAT_MS = 15000;
export const DASHBOARD_EVENT_PUSH_DEBOUNCE_MS = 150;
export const LIGHT_COMMAND_EVENT_HOLD_MS = 5000;
// Dashboard asks HA for the forecast once a minute; see specs/weather-refresh.md.
export const WEATHER_REFRESH_INTERVAL_MS = 60 * 1000;
export const TASK_ALERT_TICK_MS = 1000;
export const ICLOUD_SYNC_INTERVAL_MS = 10 * 60 * 1000;
export const ADAPTIVE_LIGHTING_POLL_MS = 60 * 1000;
export const HA_WS_RECONNECT_MIN_MS = 2000;
export const HA_WS_RECONNECT_MAX_MS = 30000;
