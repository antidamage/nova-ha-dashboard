import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { AppleTVRepeatMode } from "./apple-tv/playlists";

/**
 * The play command a preset button leaves for the Apple TV's own app
 * (Adeline, 2026-09-22).
 *
 * The dashboard cannot start a named Apple Music playlist itself: HA's
 * `apple_tv` integration is pyatv, which drives the Music app's transport and
 * reads its metadata but has no view of the library, and the Music app answers
 * no URL scheme to deep-link into a playlist. The one place in this house with
 * a MusicKit session is the Nova TV app on the television, so the press leaves
 * this record behind and that app picks it up, resolves the name against the
 * Apple Music library and plays it (`specs/apple-tv-volume.md` §Play).
 *
 * It is a handover between two processes rather than configuration, so it lives
 * in its own state file beside the other runtime state and carries the time it
 * was made: a command the app only notices long after the press is stale, and
 * running it then would start music nobody asked for.
 */

/**
 * The player a command is for: the Nova TV app on the television, or the Nova
 * app on the phone (`specs/apple-tv-volume.md` §Play). A record written before
 * targets existed was the TV's.
 */
export type PlayTarget = "appletv" | "iphone";
export const PLAY_TARGETS: readonly PlayTarget[] = ["appletv", "iphone"];

export function playTarget(value: unknown): PlayTarget | null {
  if (value === undefined || value === null || value === "") return "appletv";
  return PLAY_TARGETS.includes(value as PlayTarget) ? (value as PlayTarget) : null;
}

export type AppleTVPlayCommand = {
  /** Rising, so the app can run each press once and skip what it has run. */
  id: number;
  /** Which player runs it; each app asks only for its own. */
  target: PlayTarget;
  /** The preset's name — what the app resolves against the library. */
  name: string;
  shuffle: boolean;
  repeat: AppleTVRepeatMode;
  /** When the press happened, ISO. */
  at: string;
};

/** How long a press is worth acting on. */
export const COMMAND_WINDOW_MS = 2 * 60 * 1000;

/**
 * Where the handover lives. Read per call rather than captured at import, so a
 * test, or a host that moves its data directory, can point it elsewhere.
 */
const statePath = () =>
  process.env.NOVA_APPLETV_COMMAND_STATE ?? path.join(process.cwd(), "data", "appletv-command.json");

/** Whatever is in the file, as a command or nothing at all. */
function parse(value: unknown): AppleTVPlayCommand | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Partial<Record<keyof AppleTVPlayCommand, unknown>>;
  if (typeof record.id !== "number" || !Number.isFinite(record.id)) return null;
  if (typeof record.name !== "string" || !record.name) return null;
  if (typeof record.at !== "string") return null;
  const repeat = record.repeat;
  const target = playTarget(record.target);
  if (!target) return null;
  return {
    id: record.id,
    target,
    name: record.name,
    shuffle: record.shuffle === true,
    repeat: repeat === "all" || repeat === "infinite" ? repeat : "off",
    at: record.at,
  };
}

/**
 * The newest command, or null — for the app, which runs whatever it is handed.
 * A command past its window is not handed over at all, so a press made while
 * the television was asleep cannot start music when it next wakes.
 */
export async function readPendingPlayCommand(
  now = new Date(),
  target: PlayTarget = "appletv",
): Promise<AppleTVPlayCommand | null> {
  let command: AppleTVPlayCommand | null = null;
  try {
    command = parse(JSON.parse(await readFile(statePath(), "utf8")));
  } catch {
    // No file yet, or one that will not parse: there is no command.
    return null;
  }
  if (!command || command.target !== target) return null;
  const age = now.getTime() - Date.parse(command.at);
  // Refused at both ends: a command dated in the future — a hand-edited file,
  // or a clock that moved back — would otherwise never age out and would be
  // handed over on every poll until the wall clock caught up with it.
  if (!Number.isFinite(age) || age < 0 || age > COMMAND_WINDOW_MS) return null;
  return command;
}

/**
 * The tail of the write chain. A press is a read-modify-write of one small file
 * and two of them can arrive together, so the records go in one at a time.
 */
let writes: Promise<void> = Promise.resolve();

/**
 * Leave a command for the app, and answer the record written.
 *
 * The id rises past whatever is stored **and** past the clock: two presses
 * arriving together would otherwise read the same record and write the same id,
 * so one press's command would be overwritten and never run.
 */
export async function writePlayCommand(
  preset: { name: string; shuffle: boolean; repeat: AppleTVRepeatMode },
  now = new Date(),
  target: PlayTarget = "appletv",
): Promise<AppleTVPlayCommand> {
  const write = writes.then(async () => {
    const previous = await readCommandFile();
    const command: AppleTVPlayCommand = {
      id: Math.max((previous?.id ?? 0) + 1, now.getTime()),
      target,
      name: preset.name,
      shuffle: preset.shuffle,
      repeat: preset.repeat,
      at: now.toISOString(),
    };
    await mkdir(path.dirname(statePath()), { recursive: true });
    const temporary = `${statePath()}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(command)}\n`, "utf8");
    await rename(temporary, statePath());
    return command;
  });
  // The chain must not stop on a failed write: the next press still has to land.
  writes = write.then(() => undefined, () => undefined);
  return write;
}

/** The stored record whatever its age, so the id keeps rising. */
async function readCommandFile(): Promise<AppleTVPlayCommand | null> {
  try {
    return parse(JSON.parse(await readFile(statePath(), "utf8")));
  } catch {
    return null;
  }
}

/**
 * What the app did with the command, reported back so a press that played
 * nothing can say why (Adeline, 2026-09-22).
 *
 * The dashboard cannot start a named playlist itself, so without this the only
 * symptom of a preset whose name does not match a library playlist would be
 * silence. The preset editor shows this beside the list.
 */
export type AppleTVPlayResult = {
  /** The command this answers. */
  id: number;
  /** The preset that was asked for, as the dashboard named it. */
  name: string;
  played: boolean;
  /** Why it did not play, when it did not. */
  reason: string | null;
  at: string;
};

const resultPath = () =>
  process.env.NOVA_APPLETV_PLAY_RESULT ?? path.join(process.cwd(), "data", "appletv-play-result.json");

/** The last outcome the app reported, or nothing if it has not reported one. */
export async function readPlayResult(): Promise<AppleTVPlayResult | null> {
  try {
    const value = JSON.parse(await readFile(resultPath(), "utf8")) as Partial<Record<keyof AppleTVPlayResult, unknown>>;
    if (typeof value?.id !== "number" || typeof value?.name !== "string" || typeof value?.at !== "string") return null;
    return {
      at: value.at,
      id: value.id,
      name: value.name,
      played: value.played === true,
      reason: typeof value.reason === "string" && value.reason ? value.reason : null,
    };
  } catch {
    return null;
  }
}

export async function writePlayResult(
  result: { id: number; name: string; played: boolean; reason?: string | null },
  now = new Date(),
): Promise<AppleTVPlayResult> {
  const record: AppleTVPlayResult = {
    at: now.toISOString(),
    id: result.id,
    name: result.name,
    played: result.played,
    reason: result.reason ?? null,
  };
  await mkdir(path.dirname(resultPath()), { recursive: true });
  const temporary = `${resultPath()}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(record)}\n`, "utf8");
  await rename(temporary, resultPath());
  return record;
}
