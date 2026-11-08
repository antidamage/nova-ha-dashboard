"use client";

// The address of a separate daily tasks site, shared config. When set, the
// reminder bar ends with a tile showing that site's unfinished count.
// specs/tasks-panel.md, "Daily tasks count".

import { useEffect, useState } from "react";

import type { ConfigImportResult } from "../../../../lib/config-schema";
import { normalizeDailyTasksUrl } from "../../../../lib/daily-tasks/count";
import { isRecord } from "./roster-model";

function withDailyTasksUrl(config: unknown, dailyTasksUrl: string) {
  const base = isRecord(config) ? config : {};
  const dashboard = isRecord(base.dashboard) ? base.dashboard : {};
  const reminders = isRecord(dashboard.reminders) ? dashboard.reminders : {};
  return { ...base, dashboard: { ...dashboard, reminders: { ...reminders, dailyTasksUrl } } };
}

function savedUrl(config: unknown): string {
  const dashboard = isRecord(config) && isRecord(config.dashboard) ? config.dashboard : null;
  const reminders = dashboard && isRecord(dashboard.reminders) ? dashboard.reminders : null;
  return typeof reminders?.dailyTasksUrl === "string" ? reminders.dailyTasksUrl : "";
}

export function DailyTasksAddressField() {
  const [saved, setSaved] = useState("");
  const [draft, setDraft] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/config", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload: { config?: unknown }) => {
        const value = savedUrl(payload.config);
        setSaved(value);
        setDraft(value);
      })
      .catch(() => setMessage("Could not load the saved address"));
  }, []);

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed === saved) return;
    if (trimmed && !normalizeDailyTasksUrl(trimmed)) {
      setMessage("Enter an http:// or https:// address, or leave it empty");
      return;
    }
    try {
      // Read fresh so this write never reverts a change made elsewhere meanwhile.
      const current = (await (await fetch("/api/config", { cache: "no-store" })).json()) as { config?: unknown };
      const response = await fetch("/api/config", {
        body: JSON.stringify({ config: withDailyTasksUrl(current.config, trimmed) }),
        headers: { "Content-Type": "application/json" },
        method: "PUT",
      });
      const payload = (await response.json()) as ConfigImportResult;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok === false ? payload.errors.map((error) => error.message).join("; ") : "Save failed");
      }
      setSaved(trimmed);
      setMessage(trimmed ? "Saved. The tile appears at the end of the reminder bar." : "Cleared. No tile is shown.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Save failed");
    }
  };

  return (
    <label className="grid gap-2">
      <span className="theme-display-label zone-title-bar">Daily Tasks Address</span>
      <input
        className="cyber-text-input"
        type="url"
        inputMode="url"
        placeholder="https://host/tasks/"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
      <span className="theme-display-detail">
        {message ?? "A daily tasks site. Its unfinished count shows as the last tile in the reminder bar, and tapping it opens the site. Leave empty for no tile."}
      </span>
    </label>
  );
}
