import path from "path";
import { mkdir, readFile, rename, writeFile } from "fs/promises";

/**
 * Who is home (specs/home-users.md section 5): one small JSON file under data/,
 * written atomically. A person with no entry is away, so a fresh install and a
 * deleted file both mean "nobody is home" rather than an error.
 */

/**
 * A transition whose actions have not all landed yet. Kept until they do, so a
 * retry of the same event replays them instead of reading as "already there".
 */
export type PendingPresence = { event: "arrival" | "departure"; homeBefore: string[] };
export type PresenceRecord = { home: boolean; changedAt: string; pending?: PendingPresence };
export type PresenceFile = { members: Record<string, PresenceRecord> };

const PRESENCE_PATH =
  process.env.NOVA_DASHBOARD_PRESENCE_PATH ?? path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "presence.json");

function parse(raw: string): PresenceFile {
  const parsed = JSON.parse(raw) as Partial<PresenceFile> | null;
  const members: Record<string, PresenceRecord> = {};
  for (const [id, record] of Object.entries(parsed?.members ?? {})) {
    if (record && typeof record.home === "boolean" && typeof record.changedAt === "string") {
      const pending = record.pending;
      const validPending =
        pending && (pending.event === "arrival" || pending.event === "departure") && Array.isArray(pending.homeBefore)
          ? { event: pending.event, homeBefore: pending.homeBefore.filter((entry) => typeof entry === "string") }
          : undefined;
      members[id] = { home: record.home, changedAt: record.changedAt, ...(validPending ? { pending: validPending } : {}) };
    }
  }
  return { members };
}

export async function readPresence(): Promise<PresenceFile> {
  try {
    return parse(await readFile(/*turbopackIgnore: true*/ PRESENCE_PATH, "utf8"));
  } catch {
    return { members: {} };
  }
}

export function homeIdsOf(file: PresenceFile): Set<string> {
  return new Set(Object.entries(file.members).filter(([, record]) => record.home).map(([id]) => id));
}

// Serialised so two events arriving together cannot each read the old file and
// lose the other's write.
let queue: Promise<unknown> = Promise.resolve();

/** Record a transition, marked pending until its actions have all succeeded. */
export function setPresence(
  memberId: string,
  home: boolean,
  pending: PendingPresence | null = null,
  now = new Date(),
): Promise<PresenceFile> {
  return writeSerialised((file) => {
    file.members[memberId] = { home, changedAt: now.toISOString(), ...(pending ? { pending } : {}) };
  });
}

/** Every action of the member's last transition landed: nothing is left to replay. */
export function clearPendingPresence(memberId: string): Promise<PresenceFile> {
  return writeSerialised((file) => {
    const record = file.members[memberId];
    if (record?.pending) file.members[memberId] = { home: record.home, changedAt: record.changedAt };
  });
}

function writeSerialised(change: (file: PresenceFile) => void): Promise<PresenceFile> {
  const run = queue.then(async () => {
    const file = await readPresence();
    change(file);
    await mkdir(path.dirname(PRESENCE_PATH), { recursive: true });
    const temp = `${PRESENCE_PATH}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(file, null, 2)}\n`, "utf8");
    await rename(temp, PRESENCE_PATH);
    return file;
  });
  queue = run.catch(() => undefined);
  return run;
}
