"use client";

import { useEffect, useMemo, useState } from "react";

// Fades in behind the status orb as the page scrolls, driven purely by the
// --nova-header-fade custom property NovaAvatar's scroll handler sets on
// <html> (see NovaAvatar.tsx) — no timers, no enter/exit trigger, so the
// strip and the mini clock/date track scroll position exactly and reverse
// the instant the user scrolls back up. The reload/config buttons fade the
// opposite direction and lose pointer-events past the halfway point via the
// nova-header-controls-disabled class the same handler toggles.
function formatMiniTime(date: Date) {
  return new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  })
    .format(date)
    .replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
}

function formatMiniDate(date: Date) {
  return new Intl.DateTimeFormat("en-NZ", {
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

export function HeaderFadeStrip() {
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const { time, date } = useMemo(
    () => ({
      time: now ? formatMiniTime(now) : "--:--",
      date: now ? formatMiniDate(now) : "",
    }),
    [now],
  );

  return (
    <>
      <div className="header-fade-strip" aria-hidden="true" />
      <div className="header-mini-clock" aria-hidden="true">
        {time}
      </div>
      <div className="header-mini-date" aria-hidden="true">
        {date}
      </div>
    </>
  );
}
