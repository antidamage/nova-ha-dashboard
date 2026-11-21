// Per-user reminder preferences (specs/private-reminders.md, section 6): whether
// this user's devices chime. Keyed by person id, default on, one small file.
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";

export const USER_PREFS_PATH =
  process.env.NOVA_REMINDER_USER_PREFS ?? path.join(process.cwd(), "data", "reminder-user-prefs.json");

export type UserReminderPrefs = { chime: boolean };
type PrefsFile = Record<string, Partial<UserReminderPrefs>>;

let writeQueue: Promise<void> = Promise.resolve();

async function readFileSafe(): Promise<PrefsFile> {
  try {
    const parsed = JSON.parse(await readFile(/*turbopackIgnore: true*/ USER_PREFS_PATH, "utf8")) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as PrefsFile) : {};
  } catch {
    return {};
  }
}

export async function readUserPrefs(personId: string): Promise<UserReminderPrefs> {
  const entry = (await readFileSafe())[personId];
  return { chime: entry?.chime !== false };
}

export async function writeUserPrefs(personId: string, patch: Partial<UserReminderPrefs>): Promise<UserReminderPrefs> {
  let result: UserReminderPrefs = { chime: true };
  const run = writeQueue.then(async () => {
    const all = await readFileSafe();
    const next = { chime: typeof patch.chime === "boolean" ? patch.chime : all[personId]?.chime !== false };
    all[personId] = next;
    await mkdir(path.dirname(USER_PREFS_PATH), { recursive: true });
    const temp = `${USER_PREFS_PATH}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(all, null, 2)}\n`, "utf8");
    await rename(temp, USER_PREFS_PATH);
    result = next;
  });
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  );
  await run;
  return result;
}