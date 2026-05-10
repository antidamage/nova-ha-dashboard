"use client";

import { useEffect, useMemo, useState } from "react";

const CLOCK_TIME_ZONE = "Pacific/Auckland";
const VANCOUVER_TIME_ZONE = "America/Vancouver";

export function ClockPanel() {
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
        date: "Syncing time",
        vancouverTime: "--:--",
        zone: "Auckland",
      };
    }

    return {
      time: new Intl.DateTimeFormat("en-NZ", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h12",
        timeZone: CLOCK_TIME_ZONE,
      }).format(now),
      date: new Intl.DateTimeFormat("en-NZ", {
        weekday: "short",
        day: "2-digit",
        month: "short",
        timeZone: CLOCK_TIME_ZONE,
      }).format(now),
      vancouverTime: new Intl.DateTimeFormat("en-CA", {
        hour: "2-digit",
        minute: "2-digit",
        hourCycle: "h12",
        timeZone: VANCOUVER_TIME_ZONE,
      }).format(now),
      zone: "Auckland",
    };
  }, [now]);

  return (
    <section className="clock-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">System Time</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">Nova</h2>
        </div>
        <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
          {clock.zone}
        </div>
      </header>

      <div className="clock-face border border-neutral-700 bg-neutral-950/70 p-5" aria-live="polite">
        <p className="clock-time font-black tabular-nums text-neutral-50">{clock.time}</p>
        <p className="clock-date mt-2 font-black uppercase text-neutral-100">{clock.date}</p>
        <p className="clock-subtime mt-2 font-black uppercase text-neutral-300">
          World [Vancouver {clock.vancouverTime}]
        </p>
      </div>
    </section>
  );
}
