"use client";

// Client-side fire-and-forget event emitter. POSTs to /api/events, which writes
// the attributed event to the data/events spool for the host drain -> nova-event
// -> VictoriaLogs. Never throws and never blocks a UI interaction; `keepalive`
// lets an event survive a navigation/unload.

export type ClientEventInput = {
  service: string;
  event: string;
  source?: string;
  phase?: "start" | "end" | "point";
  detail?: Record<string, string | number | boolean | null | undefined>;
};

export function emitClientEvent(input: ClientEventInput): void {
  try {
    void fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Telemetry must never affect the interaction that emitted it.
  }
}
