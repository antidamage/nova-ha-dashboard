import { mkdir, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";

// Attributed events → the nova-monitoring stream, from inside the container.
//
// The dashboard runs in Docker and can't exec the host `nova-event` binary, so
// it uses the same file-based control channel as system power / camera reinit:
// it writes one request file into the shared, bind-persistent `data/` dir and a
// host-side drain (agent/nova-events-drain) forwards each to `nova-event`, which
// spools it to JetStream → VictoriaLogs/VictoriaMetrics.
//
//   data/events/<id>.json  <- attributed events, app -> host -> nova-event
//
// This is deliberately fire-and-forget: a spool write must NEVER delay or fail a
// device command, so callers use `emitDashboardEvent` which swallows errors.

const EVENTS_DIR = process.env.NOVA_EVENTS_DIR ?? path.join(process.cwd(), "data", "events");

// Mirrors nova-event's --phase. `point` is a one-shot; start/end bracket a
// multi-step operation (e.g. "all lights to 60%").
export type DashboardEventPhase = "start" | "end" | "point";

export type DashboardEventInput = {
  /** Grouping bucket for Grafana, e.g. "lighting", "heating", "climate", "system". */
  service: string;
  /** Event name, e.g. "all-lights", "zone-action", "aircon-auto", "reminder-alert". */
  event: string;
  /** Who/what triggered it: "user", "auto", "periodic", "system". */
  source?: string;
  phase?: DashboardEventPhase;
  /** Flat string/number/boolean detail; serialised as key=value for nova-event. */
  detail?: Record<string, string | number | boolean | null | undefined>;
};

type DashboardEventRecord = DashboardEventInput & {
  id: string;
  at: string;
};

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

/** Normalise detail to string values and drop null/undefined so nova-event sees clean k=v. */
function cleanDetail(detail: DashboardEventInput["detail"]): Record<string, string> {
  const out: Record<string, string> = {};
  if (!detail) {
    return out;
  }
  for (const [key, value] of Object.entries(detail)) {
    if (value === null || value === undefined) {
      continue;
    }
    // key=value is the nova-event wire format; keep keys/values single-line and '='-safe.
    const safeKey = key.replace(/[^A-Za-z0-9_.-]/g, "_");
    out[safeKey] = String(value).replace(/[\r\n]+/g, " ");
  }
  return out;
}

/**
 * Fire-and-forget: write one attributed event to the spool. Never throws — a
 * monitoring hiccup must not affect the device command that emitted it. Returns
 * the record on success, null if the write failed.
 */
export async function emitDashboardEvent(input: DashboardEventInput): Promise<DashboardEventRecord | null> {
  try {
    const record: DashboardEventRecord = {
      id: randomUUID(),
      at: new Date().toISOString(),
      service: input.service,
      event: input.event,
      source: input.source ?? "dashboard",
      phase: input.phase ?? "point",
      detail: cleanDetail(input.detail),
    };
    await writeJsonAtomic(path.join(EVENTS_DIR, `${record.id}.json`), record);
    return record;
  } catch {
    return null;
  }
}

/** Synchronous fire-and-forget wrapper for call sites that don't want to await. */
export function emitDashboardEventNoWait(input: DashboardEventInput): void {
  void emitDashboardEvent(input);
}
