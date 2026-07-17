import { mkdir, readFile, rename, writeFile } from "fs/promises";
import { randomUUID } from "crypto";
import path from "path";
import { readDashboardConfig } from "./dashboard-config";
import { readDashboardPreferences } from "./preferences";

// The host-side updater (nova-release) and the app communicate through plain
// files inside the shared, bind-persistent `data/` directory:
//   data/update/state.json        <- written by the host updater, read here
//   data/update/check.json        <- GitHub check cache, owned by the app
//   data/update/control/<id>.json <- update/rollback requests, app -> updater
// Using `data/` means no extra Docker mounts: the container already sees it and
// the host updater operates on the same inode under shared/data.

const UPDATE_DIR =
  process.env.NOVA_UPDATE_DIR ?? path.join(process.cwd(), "data", "update");
const STATE_PATH = path.join(UPDATE_DIR, "state.json");
const CHECK_PATH = path.join(UPDATE_DIR, "check.json");
const CONTROL_DIR = path.join(UPDATE_DIR, "control");

const GITHUB_CHECK_TIMEOUT_MS = 10_000;

export type UpdatePhase =
  | "idle"
  | "queued"
  | "checking"
  | "building"
  | "restarting"
  | "verifying"
  | "success"
  | "failed"
  | "rolledback";

/** Written by the host updater (nova-release). The app never writes this. */
export type UpdaterState = {
  schema: number;
  currentSha?: string;
  currentRef?: string;
  deployedAt?: string;
  previousSha?: string;
  phase?: UpdatePhase;
  phaseMessage?: string;
  phaseAt?: string;
  canRollback?: boolean;
  releases?: Array<{
    sha: string;
    builtAt?: string;
    current?: boolean;
    previous?: boolean;
  }>;
};

export type UpdateCheck = {
  checkedAt: string;
  ok: boolean;
  branch?: string;
  latestSha?: string;
  latestMessage?: string;
  latestCommittedAt?: string;
  error?: string;
};

export type UpdateControlAction = "apply" | "rollback";

export type UpdateControlRequest = {
  id: string;
  action: UpdateControlAction;
  sha?: string;
  requestedAt: string;
  requestedBy: string;
};

export type UpdateStatus = {
  channel: { repo: string; branch: string };
  currentSha: string | null;
  currentShortSha: string | null;
  deployedAt: string | null;
  latestSha: string | null;
  latestShortSha: string | null;
  latestMessage: string | null;
  updateAvailable: boolean;
  autoUpdate: boolean;
  canRollback: boolean;
  previousSha: string | null;
  phase: UpdatePhase;
  phaseMessage: string | null;
  phaseAt: string | null;
  lastCheckedAt: string | null;
  checkOk: boolean;
  checkError: string | null;
  busy: boolean;
};

const BUSY_PHASES = new Set<UpdatePhase>([
  "queued",
  "checking",
  "building",
  "restarting",
  "verifying",
]);

// A busy phase older than this is treated as dead, not busy: a real update
// progresses or fails within minutes, but a killed updater leaves its last
// phase (e.g. "building") in state.json forever. Consumers that gate work on
// "an update is running" must not wait on a corpse.
const BUSY_PHASE_STALE_MS = 30 * 60 * 1000;

export function isUpdaterBusyState(state: UpdaterState | null): boolean {
  if (!state?.phase || !BUSY_PHASES.has(state.phase)) {
    return false;
  }
  const phaseAt = Date.parse(state.phaseAt ?? "");
  if (Number.isFinite(phaseAt) && Date.now() - phaseAt > BUSY_PHASE_STALE_MS) {
    return false;
  }
  return true;
}

/** Cheap "is the host updater mid-run" check (reads only state.json). */
export async function updaterBusy(): Promise<boolean> {
  return isUpdaterBusyState(await readUpdaterState());
}

function shortSha(sha: string | null | undefined): string | null {
  return sha ? sha.slice(0, 7) : null;
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

async function writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
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

/**
 * Best-effort discovery of the sha this build was cut from, for environments
 * where the host updater has not written state.json yet (local dev, or a
 * pre-migration flat install).
 */
function fallbackSha(): string | null {
  const fromEnv = process.env.NOVA_DASHBOARD_SHA?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : null;
}

export async function checkGitHubForUpdate(): Promise<UpdateCheck> {
  const config = await readDashboardConfig();
  const { repo, branch } = config.update;
  const url = `https://api.github.com/repos/${repo}/commits/${encodeURIComponent(branch)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GITHUB_CHECK_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "application/vnd.github+json",
      "User-Agent": "nova-ha-dashboard-updater",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    const token = process.env.NOVA_GITHUB_TOKEN?.trim();
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const response = await fetch(url, { headers, signal: controller.signal, cache: "no-store" });
    if (!response.ok) {
      const check: UpdateCheck = {
        checkedAt: new Date().toISOString(),
        ok: false,
        branch,
        error: `GitHub responded ${response.status}`,
      };
      await writeJsonAtomic(CHECK_PATH, check);
      return check;
    }

    const data = (await response.json()) as {
      sha?: string;
      commit?: { message?: string; committer?: { date?: string } };
    };
    const check: UpdateCheck = {
      checkedAt: new Date().toISOString(),
      ok: Boolean(data.sha),
      branch,
      latestSha: data.sha,
      latestMessage: data.commit?.message?.split("\n", 1)[0],
      latestCommittedAt: data.commit?.committer?.date,
      error: data.sha ? undefined : "GitHub response missing sha",
    };
    await writeJsonAtomic(CHECK_PATH, check);
    return check;
  } catch (error) {
    const check: UpdateCheck = {
      checkedAt: new Date().toISOString(),
      ok: false,
      branch,
      error:
        (error as Error)?.name === "AbortError"
          ? "GitHub check timed out"
          : (error as Error)?.message ?? "GitHub check failed",
    };
    await writeJsonAtomic(CHECK_PATH, check);
    return check;
  } finally {
    clearTimeout(timer);
  }
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

export async function resolveAutoUpdate(): Promise<boolean> {
  const [config, prefs] = await Promise.all([
    readDashboardConfig(),
    readDashboardPreferences(),
  ]);
  return prefs.update?.autoUpdate ?? config.update.autoUpdate;
}

export async function getUpdateStatus(): Promise<UpdateStatus> {
  const [config, prefs, state, check] = await Promise.all([
    readDashboardConfig(),
    readDashboardPreferences(),
    readUpdaterState(),
    readUpdateCheck(),
  ]);

  const currentSha = state?.currentSha ?? fallbackSha();
  const latestSha = check?.ok ? check.latestSha ?? null : null;
  const phase = state?.phase ?? "idle";
  const autoUpdate = prefs.update?.autoUpdate ?? config.update.autoUpdate;

  // Only claim an update is available when both shas are known and differ.
  const updateAvailable = Boolean(
    currentSha && latestSha && currentSha !== latestSha,
  );

  return {
    channel: { repo: config.update.repo, branch: config.update.branch },
    currentSha: currentSha ?? null,
    currentShortSha: shortSha(currentSha),
    deployedAt: state?.deployedAt ?? null,
    latestSha,
    latestShortSha: shortSha(latestSha),
    latestMessage: check?.latestMessage ?? null,
    updateAvailable,
    autoUpdate,
    canRollback: Boolean(state?.canRollback && state?.previousSha),
    previousSha: state?.previousSha ?? null,
    phase,
    phaseMessage: state?.phaseMessage ?? null,
    phaseAt: state?.phaseAt ?? null,
    lastCheckedAt: check?.checkedAt ?? null,
    checkOk: Boolean(check?.ok),
    checkError: check?.ok ? null : check?.error ?? null,
    busy: BUSY_PHASES.has(phase),
  };
}
