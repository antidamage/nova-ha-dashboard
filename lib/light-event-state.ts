import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

/**
 * What the host remembers between runs about zone light events: the last
 * occurrence each rule fired for, so a restart does not re-fire it, and the
 * values staged for lights that were off when a rule fired.
 * See specs/zone-light-events.md.
 */

const STATE_PATH =
  process.env.NOVA_DASHBOARD_LIGHT_EVENT_STATE ??
  path.join(process.cwd(), "data", "light-events.json");

export type StagedLightValue = {
  /** What the light comes up at next time it is switched on. */
  rgb: [number, number, number];
  brightnessPct: number;
  stagedAt: string;
};

type LightEventState = {
  /** Event id → ISO timestamp of the occurrence it last fired for. */
  lastFired: Record<string, string>;
  /** Entity id → the value waiting for its next switch-on. */
  staged: Record<string, StagedLightValue>;
};

const EMPTY: LightEventState = { lastFired: {}, staged: {} };

let cache: LightEventState | null = null;
let writeQueue = Promise.resolve();

function normalize(raw: unknown): LightEventState {
  if (!raw || typeof raw !== "object") return { ...EMPTY };
  const value = raw as Record<string, unknown>;
  const lastFired: Record<string, string> = {};
  if (value.lastFired && typeof value.lastFired === "object") {
    for (const [id, at] of Object.entries(value.lastFired as Record<string, unknown>)) {
      if (typeof at === "string" && at) lastFired[id] = at;
    }
  }
  const staged: Record<string, StagedLightValue> = {};
  if (value.staged && typeof value.staged === "object") {
    for (const [entityId, entry] of Object.entries(value.staged as Record<string, unknown>)) {
      if (!entry || typeof entry !== "object") continue;
      const item = entry as Record<string, unknown>;
      const rgb = Array.isArray(item.rgb) ? item.rgb.map(Number) : null;
      if (!rgb || rgb.length !== 3 || rgb.some((channel) => !Number.isFinite(channel))) continue;
      staged[entityId] = {
        rgb: [rgb[0], rgb[1], rgb[2]],
        brightnessPct: Number.isFinite(item.brightnessPct) ? Number(item.brightnessPct) : 100,
        stagedAt: typeof item.stagedAt === "string" ? item.stagedAt : new Date().toISOString(),
      };
    }
  }
  return { lastFired, staged };
}

export async function readLightEventState(): Promise<LightEventState> {
  if (cache) return cache;
  try {
    cache = normalize(JSON.parse(await readFile(STATE_PATH, "utf8")));
  } catch {
    cache = { ...EMPTY };
  }
  return cache;
}

async function persist(next: LightEventState) {
  cache = next;
  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(STATE_PATH), { recursive: true });
    const temporary = `${STATE_PATH}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temporary, STATE_PATH);
  }).catch(() => {});
  await writeQueue;
}

export async function recordLightEventFired(eventId: string, occurrence: Date) {
  const state = await readLightEventState();
  await persist({ ...state, lastFired: { ...state.lastFired, [eventId]: occurrence.toISOString() } });
}

export async function stageLightValues(values: Record<string, StagedLightValue>) {
  if (!Object.keys(values).length) return;
  const state = await readLightEventState();
  await persist({ ...state, staged: { ...state.staged, ...values } });
}

/** The value waiting for this light, if any. Reading does not consume it. */
export async function stagedLightValue(entityId: string): Promise<StagedLightValue | null> {
  const state = await readLightEventState();
  return state.staged[entityId] ?? null;
}

/** Drop staged values — after they are applied, or when the light is switched off. */
export async function clearStagedLightValues(entityIds: string[]) {
  if (!entityIds.length) return;
  const state = await readLightEventState();
  if (!entityIds.some((entityId) => state.staged[entityId])) return;
  const staged = { ...state.staged };
  for (const entityId of entityIds) delete staged[entityId];
  await persist({ ...state, staged });
}

/** Tests only: forget the in-memory copy. */
export function resetLightEventStateCache() {
  cache = null;
}
