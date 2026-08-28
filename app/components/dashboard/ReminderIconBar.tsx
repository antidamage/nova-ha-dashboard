"use client";

// The reminder sigil bar that sits between the clock and the zones panel.
//
// Every reminder in the roster keeps its tile whether or not anything is due —
// the row never empties out — but the tiles are ordered by when each reminder
// is next due, with everything already dealt with pushed to the back. State is
// carried in opacity:
//
//   nothing due            dimmed to `inactiveOpacity`
//   due or active          full opacity
//   overdue past threshold full opacity + slow glow pulse in the orb alert colour
//
// Tap a tile to complete its reminder. Press and hold a just-completed tile to
// take that back (see the undo journal in lib/tasks.ts).
//
// LITE MODE (SPEC §2/§31): everything animated here is CSS, so the
// `html[data-nova-lite] *` kill-switch neutralises the pulse for free. There is
// no rAF, no canvas, and no polling of its own — the 1s tick and the task feed
// are both shared. Nothing needs an explicit `useLiteMode()` gate.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { Task } from "../../../lib/types";
import {
  FALLBACK_REMINDER_GLYPH,
  normalizeGlyph,
  normalizeReminderKey,
  type ReminderGlyph,
} from "../../../lib/reminder-glyph";
import { ReminderGlyphMark, reminderGlyphLabel } from "../reminders/icon-registry";
import { subscribeToDashboardEvents } from "../sharedDashboardEvents";
import { isTaskComplete, isTaskCurrent, isTaskOverdue, taskStartMs } from "../tasks/task-model";
import { useReminderBarSettings } from "./reminderBarSettings";
import { useModuleIntercepts } from "../modules/ModuleHost";
import { ModuleSlot } from "../modules/ModuleSlot";

type RosterEntry = {
  key: string;
  displayName: string;
  glyph: ReminderGlyph;
  showInBar: boolean;
  order: number;
};

type TileState = "idle" | "due" | "overdue";

type Tile = {
  key: string;
  displayName: string;
  glyph: ReminderGlyph;
  state: TileState;
  /** The reminder a tap would complete, if there is one. */
  taskId: string | null;
  /** Set while this tile's completion can still be held-to-undone. */
  undoUntil: number | null;
  /** Start of the soonest outstanding occurrence; Infinity when nothing is due. */
  nextDueMs: number;
  /** The roster's manual position, kept as a stable tiebreak. */
  order: number;
};

const TICK_MS = 1000;

/**
 * Soonest first, so the tile you are most likely to want is nearest the clock,
 * and everything already dealt with (`nextDueMs` of Infinity) collects at the
 * far end. The roster's manual order survives only as the tiebreak between
 * reminders due at the same moment.
 */
export function compareReminderTiles(left: TileOrder, right: TileOrder) {
  return left.nextDueMs - right.nextDueMs || left.order - right.order || left.key.localeCompare(right.key);
}

type TileOrder = Pick<Tile, "key" | "nextDueMs" | "order">;

function parseRoster(raw: string): RosterEntry[] {
  const payload = JSON.parse(raw) as { entries?: unknown };
  if (!Array.isArray(payload.entries)) {
    return [];
  }

  return payload.entries.flatMap((value) => {
    if (!value || typeof value !== "object") {
      return [];
    }
    const entry = value as Record<string, unknown>;
    const key = typeof entry.key === "string" ? entry.key : "";
    const glyph = normalizeGlyph(entry.glyph);
    if (!key || !glyph) {
      return [];
    }

    return [
      {
        key,
        displayName: typeof entry.displayName === "string" && entry.displayName ? entry.displayName : key,
        glyph,
        showInBar: entry.showInBar !== false,
        order: typeof entry.order === "number" ? entry.order : 0,
      },
    ];
  });
}

export function ReminderIconBar() {
  const runModuleIntercepts = useModuleIntercepts();
  const settings = useReminderBarSettings();
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  // Until the roster has been fetched we do not know whether there will be
  // tiles, so the bar holds its height rather than popping in and shoving the
  // whole dashboard down. Only once we know the row is genuinely empty does it
  // collapse.
  const [loaded, setLoaded] = useState(false);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [busyKeys, setBusyKeys] = useState<Set<string>>(new Set());
  /** taskId -> when its undo window closes. Cleared as the window lapses. */
  const [recentCompletions, setRecentCompletions] = useState<Record<string, number>>({});

  const holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdFired = useRef(false);

  useEffect(() => {
    const timer = setInterval(() => setNowMs(Date.now()), TICK_MS);
    return () => clearInterval(timer);
  }, []);

  // Initial load. SSE carries every later change, but the stream only pushes on
  // change — and the static demo build has no real stream at all — so the first
  // paint has to come from a plain fetch, exactly as TasksPanel does.
  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      try {
        const [taskResponse, iconResponse] = await Promise.all([
          fetch("/api/tasks?command=list", { cache: "no-store" }),
          fetch("/api/reminders/icons", { cache: "no-store" }),
        ]);

        if (cancelled) {
          return;
        }
        if (taskResponse.ok) {
          const payload = (await taskResponse.json()) as { tasks?: Task[] };
          setTasks(payload.tasks ?? []);
        }
        if (iconResponse.ok) {
          setRoster(parseRoster(await iconResponse.text()));
        }
      } catch {
        // No bar is the correct failure mode here: the reminders panel owns
        // telling the user the feed is broken.
      } finally {
        if (!cancelled) {
          setLoaded(true);
        }
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof EventSource === "undefined") {
      return;
    }

    const unsubscribe = subscribeToDashboardEvents({
      tasks: (event) => {
        try {
          const payload = JSON.parse(event.data) as { tasks?: Task[] } | Task[];
          setTasks(Array.isArray(payload) ? payload : (payload.tasks ?? []));
        } catch {
          // The panel surfaces reminder feed errors; the bar just holds its
          // last-known-good row rather than blanking.
        }
      },
      "reminder-icons": (event) => {
        try {
          setRoster(parseRoster(event.data));
        } catch {
          // As above — keep the tiles we already have.
        }
      },
    });

    return () => unsubscribe();
  }, []);

  // Expire undo offers. Cheap, and it keeps "hold to undo" from lingering on a
  // tile whose window closed while nobody was looking.
  useEffect(() => {
    setRecentCompletions((current) => {
      const next = Object.fromEntries(
        Object.entries(current).filter(([, deadline]) => deadline > nowMs),
      );
      return Object.keys(next).length === Object.keys(current).length ? current : next;
    });
  }, [nowMs]);

  const tiles = useMemo<Tile[]>(() => {
    // Group live reminders by the same normalised name the roster is keyed on.
    const byKey = new Map<string, Task[]>();
    for (const task of tasks) {
      const key = normalizeReminderKey(task.name ?? "");
      if (!key) {
        continue;
      }
      const bucket = byKey.get(key);
      if (bucket) {
        bucket.push(task);
      } else {
        byKey.set(key, [task]);
      }
    }

    return roster
      // Icon assignments are persisted independently of reminders so a
      // recurring iCloud mirror can keep its chosen glyph across resyncs.
      // They are only presentation metadata, though: an entry without a live
      // reminder must never become a permanent, empty tile in the bar.
      .filter((entry) => entry.showInBar && byKey.has(entry.key))
      .map((entry) => {
        const candidates = (byKey.get(entry.key) ?? [])
          .filter((task) => !isTaskComplete(task))
          .sort((left, right) => taskStartMs(left) - taskStartMs(right));

        const overdue = candidates.find((task) =>
          isTaskOverdue(task, nowMs, settings.overduePulseAfterMs),
        );
        const current = candidates.find((task) => isTaskCurrent(task, nowMs));
        const active = overdue ?? current ?? null;

        // A tile with nothing live can still be the one you just cleared, and
        // that is exactly when undo matters, so look for a recent completion
        // among every task carrying this reminder's name.
        const completed = (byKey.get(entry.key) ?? []).find(
          (task) => recentCompletions[task.id] !== undefined,
        );

        // Nothing outstanding means the tile is done for now, whether it is a
        // one-off that has been ticked off or a repeater that has rolled
        // forward past the horizon we can see. Either way it sorts to the back.
        const nextDueMs = candidates.length ? taskStartMs(candidates[0]) : Number.POSITIVE_INFINITY;

        return {
          key: entry.key,
          displayName: entry.displayName,
          glyph: entry.glyph ?? FALLBACK_REMINDER_GLYPH,
          state: overdue ? "overdue" : current ? "due" : "idle",
          taskId: active?.id ?? null,
          undoUntil: completed ? (recentCompletions[completed.id] ?? null) : null,
          nextDueMs: Number.isFinite(nextDueMs) ? nextDueMs : Number.POSITIVE_INFINITY,
          order: entry.order,
        } satisfies Tile;
      })
      .sort(compareReminderTiles)
      .slice(0, settings.maxTiles);
  }, [nowMs, recentCompletions, roster, settings.maxTiles, settings.overduePulseAfterMs, tasks]);

  const markBusy = useCallback((key: string, busy: boolean) => {
    setBusyKeys((current) => {
      const next = new Set(current);
      if (busy) {
        next.add(key);
      } else {
        next.delete(key);
      }
      return next;
    });
  }, []);

  const completeTile = useCallback(
    async (tile: Tile) => {
      if (!tile.taskId) {
        return;
      }

      const proceed = await runModuleIntercepts({
        id: "reminder.complete",
        source: "client",
        task: { id: tile.taskId, name: tile.displayName },
      });
      if (!proceed) {
        return;
      }

      markBusy(tile.key, true);
      const taskId = tile.taskId;
      try {
        const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}/complete`, {
          method: "POST",
        });
        if (response.ok) {
          setRecentCompletions((current) => ({
            ...current,
            [taskId]: Date.now() + settings.undoWindowMs,
          }));
        }
      } catch {
        // The tile stays lit and the SSE feed remains the source of truth, so a
        // failed tap simply looks like nothing happened. Correct.
      } finally {
        markBusy(tile.key, false);
      }
    },
    [markBusy, runModuleIntercepts, settings.undoWindowMs],
  );

  const undoTile = useCallback(
    async (tile: Tile) => {
      const taskId = Object.keys(recentCompletions).find(
        (id) => tasks.some((task) => task.id === id && normalizeReminderKey(task.name) === tile.key),
      );
      if (!taskId) {
        return;
      }

      markBusy(tile.key, true);
      try {
        await fetch(`/api/tasks/${encodeURIComponent(taskId)}/uncomplete`, { method: "POST" });
        setRecentCompletions((current) => {
          const next = { ...current };
          delete next[taskId];
          return next;
        });
      } catch {
        // Same reasoning as completeTile.
      } finally {
        markBusy(tile.key, false);
      }
    },
    [markBusy, recentCompletions, tasks],
  );

  const clearHold = useCallback(() => {
    if (holdTimer.current) {
      clearTimeout(holdTimer.current);
      holdTimer.current = null;
    }
  }, []);

  useEffect(() => clearHold, [clearHold]);

  const onPointerDown = useCallback(
    (tile: Tile) => {
      holdFired.current = false;
      if (!tile.undoUntil) {
        return;
      }

      clearHold();
      holdTimer.current = setTimeout(() => {
        holdFired.current = true;
        void undoTile(tile);
      }, settings.undoHoldMs);
    },
    [clearHold, settings.undoHoldMs, undoTile],
  );

  const onClick = useCallback(
    (tile: Tile) => {
      clearHold();
      // A completed hold already did the meaningful thing; the click that ends
      // the press must not then re-complete the reminder we just restored.
      if (holdFired.current) {
        holdFired.current = false;
        return;
      }
      void completeTile(tile);
    },
    [clearHold, completeTile],
  );

  if (loaded && tiles.length === 0) {
    return null;
  }

  return (
    <div
      className="reminder-icon-bar"
      data-outline={settings.outlineShape}
      style={{ "--reminder-idle-opacity": settings.inactiveOpacity } as React.CSSProperties}
      role="group"
      aria-label="Reminders"
    >
      {tiles.map((tile) => {
        const busy = busyKeys.has(tile.key);
        const undoable = Boolean(tile.undoUntil);
        const label = undoable
          ? `${tile.displayName} — completed, hold to undo`
          : tile.state === "idle"
            ? `${tile.displayName} — nothing due`
            : tile.state === "overdue"
              ? `${tile.displayName} — overdue`
              : `${tile.displayName} — due`;

        return (
          <button
            key={tile.key}
            type="button"
            className="reminder-tile"
            data-state={tile.state}
            data-undoable={undoable ? "true" : undefined}
            disabled={busy || (!tile.taskId && !undoable)}
            onPointerDown={() => onPointerDown(tile)}
            onPointerUp={clearHold}
            onPointerLeave={clearHold}
            onPointerCancel={clearHold}
            onContextMenu={(event) => event.preventDefault()}
            onClick={() => onClick(tile)}
            title={`${tile.displayName} (${reminderGlyphLabel(tile.glyph)})`}
            aria-label={label}
          >
            <span className="reminder-tile-glyph">
              <ReminderGlyphMark glyph={tile.glyph} />
            </span>
            <ModuleSlot
              id="reminder.tile.badge"
              context={{ task: { id: tile.taskId, name: tile.displayName } }}
            />
          </button>
        );
      })}
    </div>
  );
}
