// Sole owner of the witness state: the in-process cache and its JSON file.
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { EMPTY_STATE } from "./constants";
import type { WitnessState } from "./types";

/* ------------------------------------------------------------------ *
 * Storage
 * ------------------------------------------------------------------ */

const STORE_DIR = process.env.NOVA_KIOSK_WITNESS_DIR
  ?? path.join(process.cwd(), "data", "kiosk-witness");
const STORE_PATH = path.join(STORE_DIR, "state.json");

let cache: WitnessState | null = null;

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function loadState(): Promise<WitnessState> {
  if (cache) return cache;
  try {
    const raw = await readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as WitnessState;
    cache = {
      open: parsed.open ?? null,
      recent: Array.isArray(parsed.recent) ? parsed.recent : [],
    };
  } catch {
    // No file yet, or an unreadable one. An attribution store is not worth
    // failing a page load over.
    cache = EMPTY_STATE;
  }
  return cache;
}

export async function saveState(next: WitnessState): Promise<void> {
  cache = next;
  try {
    await writeJsonAtomic(STORE_PATH, next);
  } catch {
    // Fire-and-forget, same contract as the event spool: a witness hiccup must
    // never delay or fail a device command.
  }
}

/** For tests: drop the in-process cache. */
export function resetCache(): void {
  cache = null;
}
