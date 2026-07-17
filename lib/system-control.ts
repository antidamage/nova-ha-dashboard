import { mkdir, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";

// System power actions (restart the dashboard, reboot the host) follow the same
// file-based control channel the self-updater uses: the containerised app can't
// stop its own container or reboot the box, so it only ever *writes a request*
// into the shared, bind-persistent `data/` directory and a host-side helper
// (ops/nova-system, driven by the per-minute cron) drains it and acts.
//
//   data/system/control/<id>.json  <- restart/reboot requests, app -> host
//
// Using `data/` means no extra Docker mounts: the container already sees it and
// the host helper operates on the same inode under shared/data.

const SYSTEM_DIR =
  process.env.NOVA_SYSTEM_DIR ?? path.join(process.cwd(), "data", "system");
const CONTROL_DIR = path.join(SYSTEM_DIR, "control");

export type SystemControlAction = "restart-dashboard" | "restart-stack" | "reboot-host";

export type SystemControlRequest = {
  id: string;
  action: SystemControlAction;
  requestedAt: string;
  requestedBy: string;
};

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function requestSystemAction(
  action: SystemControlAction,
  options: { requestedBy: string },
): Promise<SystemControlRequest> {
  const request: SystemControlRequest = {
    id: randomUUID(),
    action,
    requestedAt: new Date().toISOString(),
    requestedBy: options.requestedBy.trim().slice(0, 40) || "api",
  };
  await writeJsonAtomic(path.join(CONTROL_DIR, `${request.id}.json`), request);
  return request;
}
