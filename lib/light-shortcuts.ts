import type { DashboardEntity, DashboardState, DashboardZone, SunStatus } from "./types";

export type LightShortcutTarget = "all" | "indoors" | "outside";
export type LightShortcutAction = "on" | "off";

export const LIGHT_SHORTCUT_COOLDOWN_MS = 1000;

const OFFLINE_STATES = new Set(["unavailable", "unknown"]);

const globalWithLightShortcuts = globalThis as typeof globalThis & {
  __novaLightShortcutCooldownUntil?: Partial<Record<LightShortcutTarget, number>>;
  __novaLightShortcutLastAction?: Partial<Record<LightShortcutTarget, LightShortcutAction>>;
};

function cooldownStore() {
  return (globalWithLightShortcuts.__novaLightShortcutCooldownUntil ??= {});
}

function lastActionStore() {
  return (globalWithLightShortcuts.__novaLightShortcutLastAction ??= {});
}

export function claimLightShortcutCooldown(target: LightShortcutTarget, now = Date.now()) {
  const store = cooldownStore();
  const cooldownUntil = store[target] ?? 0;
  const lastAction = lastActionStore()[target] ?? null;

  if (cooldownUntil > now) {
    return {
      allowed: false as const,
      lastAction,
      retryAfterMs: cooldownUntil - now,
    };
  }

  startLightShortcutCooldown(target, now);
  return {
    allowed: true as const,
    lastAction,
    retryAfterMs: 0,
  };
}

export function startLightShortcutCooldown(target: LightShortcutTarget, now = Date.now()) {
  cooldownStore()[target] = now + LIGHT_SHORTCUT_COOLDOWN_MS;
}

export function rememberLightShortcutAction(target: LightShortcutTarget, action: LightShortcutAction) {
  lastActionStore()[target] = action;
}

export function resetLightShortcutCooldownsForTest() {
  globalWithLightShortcuts.__novaLightShortcutCooldownUntil = {};
  globalWithLightShortcuts.__novaLightShortcutLastAction = {};
}

export function shortcutLightingEntities(entities: DashboardEntity[]) {
  return entities.filter((entity) => entity.domain === "light" || entity.isIllumination);
}

export function availableShortcutLightingEntities(entities: DashboardEntity[]) {
  return shortcutLightingEntities(entities).filter((entity) => !OFFLINE_STATES.has(entity.state));
}

export function decideLightShortcutAction(entities: DashboardEntity[]) {
  const targets = availableShortcutLightingEntities(entities);
  const onCount = targets.filter((entity) => entity.state === "on").length;
  const offCount = targets.length - onCount;

  return {
    action: onCount > offCount ? "off" as const : "on" as const,
    offCount,
    onCount,
    total: targets.length,
  };
}

export function findIndoorShortcutZone(state: DashboardState) {
  return state.zones.find((zone) => zone.id === "everything") ?? null;
}

export function findOutsideShortcutZone(state: DashboardState) {
  return state.zones.find((zone) => zone.id === "outside" || zone.name.trim().toLowerCase() === "outside") ?? null;
}

export function adaptiveShortcutLightingPreset(sun?: SunStatus | null) {
  const candlelight = sun?.state === "below_horizon";

  return {
    brightnessPct: candlelight ? 60 : 100,
    rgb: candlelight ? [255, 147, 41] as [number, number, number] : [255, 214, 170] as [number, number, number],
  };
}

export function shortcutTargetIds(zone: DashboardZone) {
  return availableShortcutLightingEntities(zone.entities).map((entity) => entity.entity_id);
}

export function shortcutTargetIdsFromEntities(entities: DashboardEntity[]) {
  return availableShortcutLightingEntities(entities).map((entity) => entity.entity_id);
}
