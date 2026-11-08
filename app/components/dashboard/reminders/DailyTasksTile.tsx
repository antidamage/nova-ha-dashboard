"use client";

// One tile at the end of the reminder bar: how many daily tasks are unfinished,
// on a separate tasks site. Tapping it opens that site. Shown only when the
// site's address is configured; a site that cannot be read shows a dim dash.
// specs/tasks-panel.md, "Daily tasks count".

import { useEffect, useState } from "react";

const REFRESH_MS = 60_000;

export function DailyTasksTile({ url }: { url: string }) {
  const [unfinished, setUnfinished] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/daily-tasks/count", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((body: { unfinished?: number | null } | null) => {
          if (!cancelled) setUnfinished(typeof body?.unfinished === "number" ? body.unfinished : null);
        })
        .catch(() => {
          if (!cancelled) setUnfinished(null);
        });
    };
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };

    load();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") load();
    }, REFRESH_MS);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [url]);

  const label = unfinished === null ? "Tasks: count unavailable" : `Tasks: ${unfinished} unfinished`;

  return (
    <a
      className="reminder-tile daily-tasks-tile"
      href={url}
      data-state={unfinished === null ? "idle" : "due"}
      aria-label={label}
      title={label}
    >
      <svg className="daily-tasks-tile-glyph" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M5 12.5l4.5 4.5L19 7.5" />
      </svg>
      <span className="daily-tasks-tile-count">{unfinished === null ? "–" : unfinished}</span>
    </a>
  );
}
