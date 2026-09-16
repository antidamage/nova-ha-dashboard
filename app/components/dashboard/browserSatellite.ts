"use client";

// Facade: the in-browser voice satellite (owner-operated home voice capture).
// The body lives in ./satellite/:
//   types.ts     hello, callback and state shapes
//   constants.ts NVAF frame sizing (16 kHz, 20 ms frames)
//   runtime.ts   BrowserSatellite — sole owner of the socket, audio contexts and
//                media stream — plus the reconnect backoff
export type {
  BrowserSatelliteCallbacks,
  BrowserSatelliteHello,
  BrowserSatelliteState,
} from "./satellite/types";
export { BrowserSatellite, browserSatelliteReconnectDelay } from "./satellite/runtime";
