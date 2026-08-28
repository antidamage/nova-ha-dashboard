"use client";

import { useEffect, useMemo, useState } from "react";
import { useAgentName } from "../AgentNameContext";
import { ModuleSlot } from "../modules/ModuleSlot";

// No timeZone is passed to Intl below, so the wall clock shows the time where
// the screen is — which is what a clock on a wall should do, and is correct for
// any installation. It used to be pinned to one city, so every deployment of
// this dashboard would have shown that city's time.
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

function formatClockTime(date: Date) {
  return new Intl.DateTimeFormat("en-NZ", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h12",
  }).format(date).replace(/\b(am|pm)\b/i, (period) => period.toUpperCase());
}

function ordinalDay(day: number) {
  const remainder = day % 100;
  if (remainder >= 11 && remainder <= 13) {
    return `${day}th`;
  }
  switch (day % 10) {
    case 1:
      return `${day}st`;
    case 2:
      return `${day}nd`;
    case 3:
      return `${day}rd`;
    default:
      return `${day}th`;
  }
}

function formatClockDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-NZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
  }).formatToParts(date);
  const day = Number(parts.find((part) => part.type === "day")?.value);
  const month = parts.find((part) => part.type === "month")?.value ?? "";
  const year = parts.find((part) => part.type === "year")?.value ?? "";

  return `${Number.isFinite(day) ? ordinalDay(day) : ""} ${month} ${year}`.trim();
}

export function ClockPanel() {
  const { agentName } = useAgentName();
  const [now, setNow] = useState<Date | null>(null);

  useEffect(() => {
    const update = () => setNow(new Date());

    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, []);

  const clock = useMemo(() => {
    if (!now) {
      return {
        time: "--:--:--",
        weekday: null,
        date: "Syncing time",
        zone: "Auckland",
      };
    }

    return {
      time: formatClockTime(now),
      weekday: new Intl.DateTimeFormat("en-NZ", {
        weekday: "short",
      }).format(now),
      date: formatClockDate(now),
      zone: "Auckland",
    };
  }, [now]);

  return (
    <section className="clock-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">System Time</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">{agentName}</h2>
        </div>
        <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
          {clock.zone}
        </div>
      </header>

      <div className="clock-face border border-neutral-700 bg-neutral-950/70 p-5" aria-live="polite">
        <p className="clock-time font-black tabular-nums text-neutral-50">{clock.time}</p>
        <p className="clock-date mt-2 font-black text-neutral-100">{clock.date}</p>
        <div className="clock-weekdays mt-1 font-black uppercase text-neutral-100" aria-label="Weekdays">
          {WEEKDAYS.map((day) => {
            const active = clock.weekday === day;
            return (
              <span
                key={day}
                className={`clock-day${active ? " clock-day-current" : ""}`}
                aria-current={active ? "date" : undefined}
              >
                {day}
              </span>
            );
          })}
        </div>
      </div>
      <ModuleSlot id="clock.after" context={{ now }} />
    </section>
  );
}
