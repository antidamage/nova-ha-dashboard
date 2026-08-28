/**
 * Shared types for the installable module system (`specs/module-system.md`).
 *
 * These are the ids and shapes both halves agree on. The client runtime imports
 * the same file, so a hook id can only ever be spelled one way.
 */

/** Render points a module may contribute UI to. Client only. */
export const SLOT_IDS = [
  "header.banner.before",
  "header.banner.after",
  "clock.after",
  "card.header.actions",
  "card.body.after",
  "card.footer",
  "thermostat.aircon.controls",
  "thermostat.heater.controls",
  "reminder.editor.fields",
  "reminder.tile.badge",
  "zone.controls.after",
  "config.module.panel",
] as const;

/** Actions a module may sit in front of. */
export const INTERCEPT_IDS = [
  "entity.action",
  "zone.action",
  "reminder.complete",
  "reminder.delete",
] as const;

/** Things that happened. Fire and forget. */
export const EVENT_IDS = [
  "entity.action.applied",
  "zone.action.applied",
  "thermostat.transition",
  "reminder.due",
  "reminder.completed",
  "reminder.uncompleted",
] as const;

export type SlotId = (typeof SLOT_IDS)[number];
export type InterceptId = (typeof INTERCEPT_IDS)[number];
export type EventId = (typeof EVENT_IDS)[number];
export type HookId = SlotId | InterceptId | EventId;

export const ALL_HOOK_IDS: readonly string[] = [...SLOT_IDS, ...INTERCEPT_IDS, ...EVENT_IDS];

export function isSlotId(value: string): value is SlotId {
  return (SLOT_IDS as readonly string[]).includes(value);
}

export function isInterceptId(value: string): value is InterceptId {
  return (INTERCEPT_IDS as readonly string[]).includes(value);
}

export function isEventId(value: string): value is EventId {
  return (EVENT_IDS as readonly string[]).includes(value);
}

/**
 * The common envelope every event carries. `at` is when the event HAPPENED —
 * never when it was delivered. Anything that queues downstream (the Discord
 * module batches on a 30s flush) carries this through, so a line delivered late
 * still reads with the right time.
 */
export type ModuleEvent = {
  id: EventId;
  at: string;
  source: "server" | "client";
  actor?: string;
  entity?: {
    id: string;
    friendlyName?: string;
    domain?: string;
    state?: string;
    previousState?: string;
  };
  zone?: { id: string; name?: string };
  task?: { id: string; name?: string; moduleData?: Record<string, unknown> };
  target?: number;
  trigger?: string;
  reason?: string;
  data?: Record<string, unknown>;
};

/** One stage of a confirmation. Structurally matches `ConfirmStage` in `app/components/ConfirmDialog.tsx`. */
export type ModuleConfirmStage = {
  title: string;
  body: string;
  confirmLabel: string;
  step?: string;
};

export type ModuleConfirmRequest = {
  stages: ModuleConfirmStage[];
  cancelLabel?: string;
  dismissHint?: string | null;
  /** How the module learns what the user decided. Client-side only. */
  onConfirmed?: () => void;
  onCancelled?: () => void;
};

/**
 * What an interceptor returns. `"proceed"` means no objection; `"cancel"` stops
 * the action outright; a confirm request hands the decision to the user through
 * the shared `ConfirmDialog`.
 */
export type InterceptDecision = "proceed" | "cancel" | { confirm: ModuleConfirmRequest };

/** Context passed to an `entity.action` / `zone.action` / reminder interceptor. */
export type InterceptContext = {
  id: InterceptId;
  source: "server" | "client";
  entity?: { id: string; friendlyName?: string; domain?: string; state?: string };
  zone?: { id: string; name?: string };
  task?: { id: string; name?: string; moduleData?: Record<string, unknown> };
  service?: string;
  data?: Record<string, unknown>;
};

export type ModuleStatusReport = {
  state: "ok" | "needs-setup" | "error";
  summary?: string;
  detail?: Record<string, unknown>;
};

/** One entry in `data/modules/installed.json`. */
export type InstalledModuleRecord = {
  id: string;
  version: string;
  enabled: boolean;
  /** Where it came from: an upload, or the default-install URL. */
  source: string;
  installedAt: string;
  /** Lifecycle state, distinct from the module's own self-reported status. */
  state: "loaded" | "disabled" | "failed";
  error?: string;
};

/** What the config tab and the client runtime are told about a module. */
export type ModuleSummary = {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  repository?: string;
  enabled: boolean;
  state: InstalledModuleRecord["state"];
  error?: string;
  hooks: string[];
  hasClient: boolean;
  hasServer: boolean;
  /** mtime-derived, so the client import URL changes when the file does. */
  clientVersion: string;
  secrets: { name: string; configured: boolean }[];
  status?: ModuleStatusReport;
};
