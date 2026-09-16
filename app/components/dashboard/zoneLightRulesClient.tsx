"use client";

import { Clock, Flame, Gauge, Lightbulb, Pin, Power, PowerOff, Sun } from "lucide-react";
import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  createRule,
  deleteRule,
  effectiveZoneRules,
  presetRowRules,
  reorderRules,
  ruleTrigger,
  updateRule,
  type RuleOperationResult,
  type ZoneLightRule,
  type ZoneLightRuleStore,
} from "../../../lib/zone-light-rules";
import type { SpectrumCursor } from "../../../lib/types";
import { ReminderGlyphMark } from "../reminders/icon-registry";
import { IconButton } from "./IconButton";

/**
 * Client side of the zone lighting rules (specs/zone-light-events.md, round 2):
 * one shared store per page so the Advanced editor and the preset rows stay in
 * step, the API calls, and a sessionStorage store in demo mode where there is
 * no host behind `/api`.
 */

const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const DEMO_KEY = "nova.dashboard.demoZoneRules.v1";
const API = "/api/lighting/zone-rules";

type Snapshot = { store: ZoneLightRuleStore; switchOnEntityIds: string[]; loaded: boolean; error: string | null };

let snapshot: Snapshot = { store: { rules: [], seededZoneIds: [] }, switchOnEntityIds: [], loaded: false, error: null };
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function publish(next: Partial<Snapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

function readDemo(): { store: ZoneLightRuleStore; switchOnEntityIds: string[] } {
  try {
    const raw = window.sessionStorage.getItem(DEMO_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    if (parsed?.store) return parsed;
  } catch {
    // An unreadable demo store starts empty.
  }
  return { store: { rules: [], seededZoneIds: [] }, switchOnEntityIds: [] };
}

function writeDemo(store: ZoneLightRuleStore, switchOnEntityIds: string[]) {
  try {
    window.sessionStorage.setItem(DEMO_KEY, JSON.stringify({ store, switchOnEntityIds }));
  } catch {
    // Demo persistence is best effort.
  }
}

async function load() {
  if (DEMO_MODE) {
    publish({ ...readDemo(), loaded: true, error: null });
    return;
  }
  try {
    const response = await fetch(API);
    if (!response.ok) throw new Error("Could not read lighting rules");
    const body = await response.json() as { rules: ZoneLightRule[]; seededZoneIds: string[]; switchOnEntityIds: string[] };
    publish({
      store: { rules: body.rules ?? [], seededZoneIds: body.seededZoneIds ?? [] },
      switchOnEntityIds: body.switchOnEntityIds ?? [],
      loaded: true,
      error: null,
    });
  } catch (cause) {
    publish({ error: cause instanceof Error ? cause.message : "Could not read lighting rules" });
  }
}

function ensureLoaded() {
  if (!loading) {
    loading = load().finally(() => {
      if (!snapshot.loaded) loading = null;
    });
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function send(method: string, path: string, body: unknown, local: RuleOperationResult | null) {
  if (DEMO_MODE) {
    if (local && !local.ok) throw new Error(local.error);
    if (local?.ok) {
      writeDemo(local.store, snapshot.switchOnEntityIds);
      publish({ store: local.store, error: null });
    }
    return;
  }
  const response = await fetch(path, {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Could not save lighting rules");
  await load();
}

/** Resets the page store; tests only. */
export function resetZoneLightRulesForTest() {
  snapshot = { store: { rules: [], seededZoneIds: [] }, switchOnEntityIds: [], loaded: false, error: null };
  loading = null;
}

export function useZoneLightRules(zoneId: string) {
  const state = useSyncExternalStore(subscribe, () => snapshot, () => snapshot);
  const [error, setError] = useState<string | null>(null);
  useEffect(ensureLoaded, []);

  const run = useCallback(async (operation: () => Promise<void>) => {
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save lighting rules");
    }
  }, []);

  return {
    loaded: state.loaded,
    error: error ?? state.error,
    rules: useMemo(() => effectiveZoneRules(state.store, zoneId), [state.store, zoneId]),
    presets: useMemo(() => presetRowRules(state.store, zoneId), [state.store, zoneId]),
    switchOnEntityIds: state.switchOnEntityIds,
    create: (rule: ZoneLightRule) =>
      run(() => send("POST", API, { rule }, createRule(snapshot.store, rule))),
    update: (id: string, patch: Partial<ZoneLightRule>) => {
      // Show the edit at once; the host's answer replaces it.
      const local = updateRule(snapshot.store, id, patch);
      if (local.ok && !DEMO_MODE) publish({ store: local.store });
      return run(() => send("PATCH", `${API}/${encodeURIComponent(id)}`, { rule: patch }, local));
    },
    remove: (id: string) =>
      run(() => send("DELETE", `${API}/${encodeURIComponent(id)}`, undefined, deleteRule(snapshot.store, id))),
    reorder: (ids: string[]) =>
      run(() => send("PUT", `${API}/order`, { zoneId, ids }, reorderRules(snapshot.store, zoneId, ids))),
    setSwitchOn: (switchOnEntityIds: string[]) =>
      run(async () => {
        publish({ switchOnEntityIds });
        if (DEMO_MODE) {
          writeDemo(snapshot.store, switchOnEntityIds);
          return;
        }
        const response = await fetch(API, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ switchOnEntityIds }),
        });
        if (!response.ok) throw new Error("Could not save light switch-ons");
      }),
  };
}

export type RulePresetHandlers = {
  applyPreset: (action: "on" | "candlelight" | "white") => unknown;
  setLocalBrightness: (value: number) => void;
  rememberSpectrum: (value: { cursor: SpectrumCursor; preview: [number, number, number] }) => void;
  onZoneAction: (action: string, body?: Record<string, unknown>) => unknown;
};

/** Press a preset: apply the rule's value now. */
export async function triggerRulePreset(rule: ZoneLightRule, handlers: RulePresetHandlers) {
  const trigger = ruleTrigger(rule);
  if (trigger.kind === "host") {
    if (DEMO_MODE) return;
    await fetch(`${API}/${encodeURIComponent(rule.id)}/trigger`, { method: "POST" });
    return;
  }
  if (trigger.action === "off") {
    await handlers.onZoneAction("off");
    return;
  }
  if (trigger.action === "color" && trigger.rgb && trigger.cursor) {
    handlers.setLocalBrightness(trigger.brightnessPct ?? 100);
    handlers.rememberSpectrum({ cursor: trigger.cursor, preview: trigger.rgb });
    await handlers.onZoneAction("color", { rgb: trigger.rgb, brightnessPct: trigger.brightnessPct, cursor: trigger.cursor });
    return;
  }
  await handlers.applyPreset(trigger.action as "on" | "candlelight" | "white");
}

export function ruleVariant(rule: ZoneLightRule): "yellow" | "pink" | "white" {
  if (rule.kind === "preset" && rule.builtin === "off") return "pink";
  if (rule.kind === "preset" && !rule.builtin && rule.value.saturation === 0) return "white";
  return "yellow";
}

/** The rule's chosen glyph, or the icon its kind always had. */
export function RuleIcon({ rule, className }: { rule: ZoneLightRule; className?: string }) {
  if (rule.preset?.icon) {
    return <span className={`zone-rule-glyph ${className ?? ""}`}><ReminderGlyphMark glyph={rule.preset.icon} /></span>;
  }
  const props = { "aria-hidden": true as const, className };
  if (rule.kind === "preset" && rule.builtin === "on") return <Power {...props} />;
  if (rule.kind === "preset" && rule.builtin === "off") return <PowerOff {...props} />;
  if (rule.kind === "adaptive") return <Flame {...props} />;
  if (rule.kind === "event") return <Clock {...props} />;
  if (rule.kind === "threshold") return <Gauge {...props} />;
  if (rule.kind === "pinned") return <Pin {...props} />;
  return rule.value.saturation === 0 ? <Sun {...props} /> : <Lightbulb {...props} />;
}

/**
 * The zone's preset row under the dial: On, the shown custom presets in the
 * user's order, Off. Pressing one applies its rule now.
 */
export function ZoneRulePresetRow({
  adaptiveLabel,
  hasLightDevices,
  hasSwitches,
  handlers,
  zoneId,
}: {
  adaptiveLabel: string;
  hasLightDevices: boolean;
  hasSwitches: boolean;
  handlers: RulePresetHandlers;
  zoneId: string;
}) {
  const { presets } = useZoneLightRules(zoneId);
  return (
    <div className="zone-lighting-presets" role="group" aria-label="Lighting presets">
      {presets.map((rule) => {
        const off = rule.kind === "preset" && rule.builtin === "off";
        const on = rule.kind === "preset" && rule.builtin === "on";
        const name = rule.name ?? (rule.kind === "adaptive" ? "Adaptive" : "Preset");
        const label = on ? `On: ${adaptiveLabel}` : rule.kind === "adaptive" ? adaptiveLabel : name;
        return (
          <IconButton
            key={rule.id}
            label={label}
            disabled={off ? !hasLightDevices && !hasSwitches : !hasLightDevices}
            variant={ruleVariant(rule)}
            onClick={() => void triggerRulePreset(rule, handlers)}
          >
            <RuleIcon rule={rule} /><span>{name}</span>
          </IconButton>
        );
      })}
    </div>
  );
}
