"use client";

// Everything that shapes the reminder surfaces, in one place under
// Appearance & Dashboard.
//
// Two storage models meet here on purpose:
//   * the banner switch is PER DEVICE (localStorage) — whether a screen shouts
//     at the room is a property of that screen
//   * the outline shape and the sigil roster are SHARED config, because they
//     describe the household's reminders, not one panel's manners
//
// AccentConfig already mixes the two the same way in its "This Device" block.

import { BellRing, Circle, RectangleHorizontal, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { ConfigImportResult } from "../../lib/config-schema";
import {
  FALLBACK_REMINDER_GLYPH,
  normalizeGlyph,
  type ReminderGlyph,
} from "../../lib/reminder-glyph";
import { CheckboxRow, ConfigAccordion } from "./ConfigControls";
import { useReminderBannerSetting } from "./dashboard/reminderBannerSetting";
import type { ReminderOutlineShape } from "./dashboard/reminderBarSettings";
import { ReminderGlyphMark, reminderGlyphLabel } from "./reminders/icon-registry";
import { ReminderIconPicker } from "./reminders/ReminderIconPicker";

type RosterEntry = {
  key: string;
  displayName: string;
  glyph: ReminderGlyph;
  source: "user" | "llm" | "keyword" | "fallback";
  showInBar: boolean;
  order: number;
};

const OUTLINE_OPTIONS: { value: ReminderOutlineShape; label: string; Icon: typeof Circle }[] = [
  { value: "rounded-rect", label: "Rounded", Icon: RectangleHorizontal },
  { value: "circle", label: "Circle", Icon: Circle },
  { value: "square", label: "Square", Icon: Square },
];

const SOURCE_LABELS: Record<RosterEntry["source"], string> = {
  user: "Yours",
  llm: "Auto",
  keyword: "Auto",
  fallback: "Default",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parseRoster(value: unknown): RosterEntry[] {
  if (!isRecord(value) || !Array.isArray(value.entries)) {
    return [];
  }

  return value.entries.flatMap((raw) => {
    if (!isRecord(raw) || typeof raw.key !== "string") {
      return [];
    }
    const glyph = normalizeGlyph(raw.glyph) ?? FALLBACK_REMINDER_GLYPH;
    const source = raw.source;

    return [
      {
        key: raw.key,
        displayName: typeof raw.displayName === "string" && raw.displayName ? raw.displayName : raw.key,
        glyph,
        source:
          source === "user" || source === "llm" || source === "keyword" || source === "fallback"
            ? source
            : "fallback",
        showInBar: raw.showInBar !== false,
        order: typeof raw.order === "number" ? raw.order : 0,
      },
    ];
  });
}

function configWithOutlineShape(config: unknown, outlineShape: ReminderOutlineShape) {
  const base = isRecord(config) ? config : {};
  const dashboard = isRecord(base.dashboard) ? base.dashboard : {};
  const reminders = isRecord(dashboard.reminders) ? dashboard.reminders : {};

  return {
    ...base,
    dashboard: { ...dashboard, reminders: { ...reminders, outlineShape } },
  };
}

export function RemindersConfig() {
  const [bannersEnabled, setBannersEnabled] = useReminderBannerSetting();
  const [config, setConfig] = useState<unknown>(null);
  const [outlineShape, setOutlineShape] = useState<ReminderOutlineShape>("rounded-rect");
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const loadConfig = useCallback(async () => {
    try {
      const response = await fetch("/api/config", { cache: "no-store" });
      const payload = (await response.json()) as { config?: unknown; error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Dashboard config request failed");
      }

      setConfig(payload.config ?? null);
      const shape = isRecord(payload.config)
        ? (payload.config.dashboard as Record<string, unknown> | undefined)
        : undefined;
      const reminders = isRecord(shape?.reminders) ? shape.reminders : null;
      const value = reminders?.outlineShape;
      if (value === "circle" || value === "square" || value === "rounded-rect") {
        setOutlineShape(value);
      }
    } catch (error) {
      console.error("[nova-dashboard] failed to load reminder config", error);
    }
  }, []);

  const loadRoster = useCallback(async () => {
    try {
      const response = await fetch("/api/reminders/icons", { cache: "no-store" });
      setRoster(parseRoster(await response.json()));
    } catch (error) {
      console.error("[nova-dashboard] failed to load reminder icons", error);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
    void loadRoster();
  }, [loadConfig, loadRoster]);

  const commitOutlineShape = useCallback(
    async (shape: ReminderOutlineShape) => {
      const previous = outlineShape;
      setOutlineShape(shape);

      try {
        const response = await fetch("/api/config", {
          body: JSON.stringify({ config: configWithOutlineShape(config, shape) }),
          headers: { "Content-Type": "application/json" },
          method: "PUT",
        });
        const payload = (await response.json()) as ConfigImportResult;
        if (!response.ok || !payload.ok) {
          throw new Error(
            payload.ok === false
              ? payload.errors.map((error) => error.message).join("; ")
              : "Reminder config update failed",
          );
        }
        setConfig(payload.config);
      } catch (error) {
        setOutlineShape(previous);
        setMessage(error instanceof Error ? error.message : "Failed to save outline shape");
      }
    },
    [config, outlineShape],
  );

  const patchEntry = useCallback(
    async (key: string, patch: { glyph?: ReminderGlyph; showInBar?: boolean }) => {
      // Optimistic: the roster list is the only reader, and a failed PATCH
      // reloads it below, so a wrong tile can never persist.
      setRoster((current) =>
        current.map((entry) => (entry.key === key ? { ...entry, ...patch, source: patch.glyph ? "user" : entry.source } : entry)),
      );

      try {
        const response = await fetch("/api/reminders/icons", {
          body: JSON.stringify({ key, ...patch }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        });
        if (!response.ok) {
          const payload = (await response.json()) as { error?: string };
          throw new Error(payload.error ?? "Reminder icon update failed");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to save reminder icon");
        void loadRoster();
      }
    },
    [loadRoster],
  );

  const move = useCallback(
    async (key: string, delta: -1 | 1) => {
      const ordered = [...roster].sort((left, right) => left.order - right.order);
      const index = ordered.findIndex((entry) => entry.key === key);
      const target = index + delta;
      if (index < 0 || target < 0 || target >= ordered.length) {
        return;
      }

      [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
      const renumbered = ordered.map((entry, position) => ({ ...entry, order: position }));
      setRoster(renumbered);

      try {
        const response = await fetch("/api/reminders/icons", {
          body: JSON.stringify({ keys: renumbered.map((entry) => entry.key) }),
          headers: { "Content-Type": "application/json" },
          method: "PATCH",
        });
        if (!response.ok) {
          throw new Error("Reminder reorder failed");
        }
      } catch (error) {
        setMessage(error instanceof Error ? error.message : "Failed to reorder reminders");
        void loadRoster();
      }
    },
    [loadRoster, roster],
  );

  const ordered = useMemo(
    () => [...roster].sort((left, right) => left.order - right.order || left.key.localeCompare(right.key)),
    [roster],
  );
  const editing = ordered.find((entry) => entry.key === editingKey) ?? null;

  return (
    <ConfigAccordion
      id="reminders"
      title="Reminders"
      icon={<BellRing className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <div className="grid gap-4">
        <CheckboxRow
          checked={bannersEnabled}
          label="Reminder Banners"
          detail={
            bannersEnabled
              ? "This screen shows the bottom bar and the full-screen alert, and repeats the reminder sound until it is cleared"
              : "This screen stays quiet: no bottom bar, no full-screen alert, and the reminder sound plays once when a reminder becomes due"
          }
          onChange={setBannersEnabled}
        />

        <div className="grid gap-2">
          <span className="theme-display-label zone-title-bar">Icon Outline</span>
          <div className="flex flex-wrap gap-2">
            {OUTLINE_OPTIONS.map((option) => {
              const active = outlineShape === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  className={`inline-flex min-h-11 items-center gap-2 border px-4 py-1 text-xs font-black uppercase ${
                    active
                      ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100"
                      : "border-neutral-700 bg-neutral-950/70 text-neutral-400"
                  }`}
                  onClick={() => void commitOutlineShape(option.value)}
                >
                  <option.Icon className="h-4 w-4" aria-hidden="true" />
                  {option.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid gap-2">
          <span className="theme-display-label zone-title-bar">Reminder Icons</span>
          <p className="theme-display-detail">
            Repeating reminders join the bar automatically. Tap an icon to change it — including
            reminders mirrored read-only from Apple.
          </p>

          {ordered.length === 0 ? (
            <p className="theme-display-detail">
              No reminders seen yet. They appear here as they are created or synced.
            </p>
          ) : (
            <ul className="grid gap-2">
              {ordered.map((entry, index) => (
                <li
                  key={entry.key}
                  className="flex items-center gap-3 border border-neutral-700 bg-neutral-950/70 p-3"
                >
                  <button
                    type="button"
                    className="reminder-config-glyph"
                    onClick={() => setEditingKey(entry.key)}
                    aria-label={`Change icon for ${entry.displayName}`}
                    title={reminderGlyphLabel(entry.glyph)}
                  >
                    <ReminderGlyphMark glyph={entry.glyph} />
                  </button>

                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-black uppercase text-neutral-100">
                      {entry.displayName}
                    </p>
                    <p className="font-mono text-xs font-black uppercase text-neutral-500">
                      {SOURCE_LABELS[entry.source]} · {reminderGlyphLabel(entry.glyph)}
                    </p>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      className="min-h-9 border border-neutral-700 px-2 text-xs font-black text-neutral-300 disabled:opacity-30"
                      disabled={index === 0}
                      onClick={() => void move(entry.key, -1)}
                      aria-label={`Move ${entry.displayName} earlier`}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="min-h-9 border border-neutral-700 px-2 text-xs font-black text-neutral-300 disabled:opacity-30"
                      disabled={index === ordered.length - 1}
                      onClick={() => void move(entry.key, 1)}
                      aria-label={`Move ${entry.displayName} later`}
                    >
                      ↓
                    </button>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={entry.showInBar}
                    className={`min-h-9 border px-3 text-xs font-black uppercase ${
                      entry.showInBar
                        ? "border-cyan-300/60 bg-cyan-300/10 text-cyan-100"
                        : "border-neutral-700 text-neutral-500"
                    }`}
                    onClick={() => void patchEntry(entry.key, { showInBar: !entry.showInBar })}
                  >
                    {entry.showInBar ? "In bar" : "Hidden"}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {message ? <p className="theme-display-detail text-amber-200">{message}</p> : null}
      </div>

      {editing ? (
        <ReminderIconPicker
          open
          glyph={editing.glyph}
          reminderName={editing.displayName}
          onClose={() => setEditingKey(null)}
          onSelect={(glyph) => {
            void patchEntry(editing.key, { glyph });
            setEditingKey(null);
          }}
        />
      ) : null}
    </ConfigAccordion>
  );
}
