/**
 * Home Assistant REST/WebSocket client — facade. The body lives in lib/ha/client/;
 * this file keeps the import path (and the vi.mock path) stable for its callers.
 *
 *   client/connection.ts     HA_URL, HA_TOKEN, auth headers, haRest (timeout)
 *   client/service-calls.ts  callService, latest-wins lanes, callServiceWithResponse
 *   client/websocket.ts      haWs one-shot command, subscribeHaStateChanges
 */
export { haRest } from "./client/connection";
export { callService, callServiceWithResponse, resetLatestServiceLanesForTest } from "./client/service-calls";
export type { CallServiceOptions } from "./client/service-calls";
export { haWs, subscribeHaStateChanges } from "./client/websocket";
export type { HaStateChangeEvent } from "./client/websocket";
