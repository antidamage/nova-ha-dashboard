import { readDashboardConfig } from "../dashboard-config";
import { readDashboardPreferences } from "../preferences";
import { BUSY_PHASES } from "./constants";
import { definedSha, fallbackSha, shortSha } from "./status-model";
import { readUpdateCheck, readUpdaterState } from "./store";
import type { UpdateStatus } from "./types";

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

  const currentSha = definedSha(state?.currentSha) ?? fallbackSha();
  const latestSha = check?.ok ? definedSha(check.latestSha) : null;
  const phase = state?.phase ?? "idle";
  const autoUpdate = prefs.update?.autoUpdate ?? config.update.autoUpdate;
  // Defaults off, and deliberately has no config-schema key to fall back to:
  // the home page stays clear of the banner until someone asks for it here.
  const showUpdatesOnHome = prefs.update?.showUpdatesOnHome ?? false;

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
    showUpdatesOnHome,
    canRollback: Boolean(state?.canRollback && definedSha(state?.previousSha)),
    previousSha: definedSha(state?.previousSha),
    phase,
    phaseMessage: state?.phaseMessage ?? null,
    phaseAt: state?.phaseAt ?? null,
    lastCheckedAt: check?.checkedAt ?? null,
    checkOk: Boolean(check?.ok),
    checkError: check?.ok ? null : check?.error ?? null,
    busy: BUSY_PHASES.has(phase),
  };
}
