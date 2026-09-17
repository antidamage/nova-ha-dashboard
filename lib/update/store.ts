// Sole owner of the update directory's files: state.json and check.json reads,
// and the control requests the host updater picks up.
import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { CHECK_PATH, CONTROL_DIR, STATE_PATH } from "./constants";
import { isUpdaterBusyState } from "./status-model";
import type { UpdateCheck, UpdateControlAction, UpdateControlRequest, UpdaterState } from "./types";

/** Cheap "is the host updater mid-run" check (reads only state.json). */
export async function updaterBusy(): Promise<boolean> {
  return isUpdaterBusyState(await readUpdaterState());
}

async function readJson<T>(filePath: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function readUpdaterState(): Promise<UpdaterState | null> {
  return readJson<UpdaterState>(STATE_PATH);
}

export async function readUpdateCheck(): Promise<UpdateCheck | null> {
  return readJson<UpdateCheck>(CHECK_PATH);
}

async function writeControlRequest(
  action: UpdateControlAction,
  options: { sha?: string; requestedBy: string },
): Promise<UpdateControlRequest> {
  const request: UpdateControlRequest = {
    id: randomUUID(),
    action,
    sha: options.sha,
    requestedAt: new Date().toISOString(),
    requestedBy: options.requestedBy,
  };
  await writeJsonAtomic(path.join(CONTROL_DIR, `${request.id}.json`), request);
  return request;
}

export function requestUpdate(options: { sha?: string; requestedBy: string }) {
  return writeControlRequest("apply", options);
}

export function requestRollback(options: { requestedBy: string }) {
  return writeControlRequest("rollback", { requestedBy: options.requestedBy });
}
