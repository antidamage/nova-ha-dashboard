"use client";

import { useEffect, useRef, useState } from "react";
import type { RouterStatus } from "../../../lib/types";
import { classNames, clamp } from "./shared";

export function RouterPanel({ router: initialRouter }: { router: RouterStatus }) {
  const [router, setRouter] = useState(initialRouter);
  const polling = useRef(false);

  useEffect(() => {
    setRouter(initialRouter);
  }, [initialRouter]);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      if (polling.current || document.hidden) {
        return;
      }

      polling.current = true;
      try {
        const response = await fetch("/api/router", { cache: "no-store" });
        const payload = await response.json();
        if (alive && response.ok) {
          setRouter(payload as RouterStatus);
        }
      } catch {
        // Keep the last known router reading if a single fast poll misses.
      } finally {
        polling.current = false;
      }
    };

    void load();
    const timer = window.setInterval(load, 333);
    const refreshVisibleState = () => {
      if (!document.hidden) {
        void load();
      }
    };

    window.addEventListener("focus", refreshVisibleState);
    window.addEventListener("online", refreshVisibleState);
    window.addEventListener("pageshow", refreshVisibleState);
    document.addEventListener("visibilitychange", refreshVisibleState);

    return () => {
      alive = false;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVisibleState);
      window.removeEventListener("online", refreshVisibleState);
      window.removeEventListener("pageshow", refreshVisibleState);
      document.removeEventListener("visibilitychange", refreshVisibleState);
    };
  }, []);

  const download = router.download.value ?? 0;
  const upload = router.upload.value ?? 0;
  const scaleMax = Math.max(0.25, Math.ceil(Math.max(download, upload) * 4) / 4);
  const downloadPct = clamp((download / scaleMax) * 100, 0, 100);
  const uploadPct = clamp((upload / scaleMax) * 100, 0, 100);
  const gaugeDeg = (downloadPct / 100) * 180;

  return (
    <section className="router-panel border border-neutral-700 bg-neutral-950/70 p-5">
      <header className="mb-4 flex items-center justify-between gap-4">
        <div>
          <p className="text-sm font-black uppercase text-cyan-300">Network Interface</p>
          <h2 className="mt-1 text-3xl font-black uppercase text-neutral-50">{router.name}</h2>
        </div>
        <div className="border border-cyan-300/50 px-3 py-2 text-xs font-black uppercase text-cyan-200">
          WAN {router.wanState}
        </div>
      </header>

      <div className="router-grid grid gap-4">
        <div className="router-gauge-card border border-neutral-700 bg-neutral-950/70 p-5">
          <div
            className="router-gauge mx-auto"
            style={{ "--router-gauge-deg": `${gaugeDeg}deg` } as React.CSSProperties}
          >
            <div className="router-gauge-readout">
              <p className="text-5xl font-black tabular-nums text-neutral-50">{router.download.display}</p>
              <p className="mt-2 text-base font-black uppercase text-neutral-100">Download speed</p>
            </div>
          </div>
        </div>

        <div className="router-throughput-card border border-neutral-700 bg-neutral-950/70 p-5">
          <div className="router-throughput-track">
            <span className="router-throughput-down" style={{ width: `${downloadPct}%` }} />
            <span className="router-throughput-up" style={{ width: `${uploadPct}%` }} />
          </div>
          <div className="mt-4 grid gap-2">
            <div className="flex min-w-0 items-center gap-2 text-xs font-black text-neutral-100">
              <span className="h-3 w-3 shrink-0 bg-cyan-300" />
              <span className="truncate">Download</span>
              <span className="ml-auto shrink-0 tabular-nums text-neutral-400">{router.download.display}</span>
            </div>
            <div className="flex min-w-0 items-center gap-2 text-xs font-black text-neutral-100">
              <span className="h-3 w-3 shrink-0 bg-yellow-300" />
              <span className="truncate">Upload</span>
              <span className="ml-auto shrink-0 tabular-nums text-neutral-400">{router.upload.display}</span>
            </div>
          </div>
        </div>

        <div className="router-status-card router-wan-card border border-neutral-700 bg-neutral-950/70 p-5">
          <p className="text-sm font-black uppercase text-cyan-300">WAN Status</p>
          <div className="mt-2 flex items-center gap-3">
            <span
              className={classNames(
                "h-4 w-4 border",
                router.wanConnected ? "border-emerald-300 bg-emerald-300" : "border-red-400 bg-red-400",
              )}
            />
            <p className="text-2xl font-black uppercase text-neutral-50">{router.wanState}</p>
          </div>
        </div>
      </div>
    </section>
  );
}
