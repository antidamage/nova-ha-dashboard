import { mkdir, readdir, readFile, rename, unlink, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { cameraDataRoot } from "./config";

// Host control channel for a FULL camera re-initialisation (the USB-hardware
// half the containerised app can't do itself). Mirrors lib/system-control.ts:
// the app only writes a request file into the bind-mounted data dir, and the
// root camera watchdog on the host drains it and performs the deep re-init
// (free the device, usbreset, USB re-enumerate) immediately, bypassing its
// normal recovery cooldown.
//
//   data/camera/<id>/control/<uuid>.json   { action: "reinitialize", ... }
//
// Living under the camera's own data dir means no extra Docker mounts — the
// container already writes segments there and the watchdog already reads it.

export type CameraControlAction = "reinitialize";

export type CameraControlRequest = {
  id: string;
  cameraId: string;
  action: CameraControlAction;
  requestedAt: string;
  requestedBy: string;
};

function controlDir(cameraId: string): string {
  return path.join(cameraDataRoot(), cameraId, "control");
}

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

/** App side: queue a full re-init request for the host watchdog to drain. */
export async function requestCameraReinit(
  cameraId: string,
  requestedBy: string,
): Promise<CameraControlRequest> {
  const request: CameraControlRequest = {
    id: randomUUID(),
    cameraId,
    action: "reinitialize",
    requestedAt: new Date().toISOString(),
    requestedBy: requestedBy.trim().slice(0, 40) || "api",
  };
  await writeJsonAtomic(path.join(controlDir(cameraId), `${request.id}.json`), request);
  return request;
}

/**
 * Host side (used by tooling/tests; the watchdog reads the dir directly in
 * Python): drain and return any pending requests for a camera, deleting them.
 */
export async function drainCameraReinitRequests(cameraId: string): Promise<CameraControlRequest[]> {
  const dir = controlDir(cameraId);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(".json"));
  } catch {
    return [];
  }
  const out: CameraControlRequest[] = [];
  for (const name of names) {
    const full = path.join(dir, name);
    try {
      const parsed = JSON.parse(await readFile(full, "utf8")) as CameraControlRequest;
      out.push(parsed);
    } catch {
      /* ignore malformed */
    }
    await unlink(full).catch(() => undefined);
  }
  return out;
}
