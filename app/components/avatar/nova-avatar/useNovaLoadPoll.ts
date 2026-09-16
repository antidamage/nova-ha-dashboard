"use client";

import { type RefObject, useEffect } from "react";
import type { NovaLoadSample } from "../../orb-info/useOrbInfo";
import { POLL_MS } from "./avatar-model";
import type { LoadResponse } from "./types";

/** The 2s /api/nova-load poll feeding the orb's target load and host info modules. */
export function useNovaLoadPoll({
  hidden,
  orbOptedOut,
  targetLoadRef,
  ingestNovaLoadRef,
}: {
  hidden: boolean;
  orbOptedOut: boolean;
  targetLoadRef: RefObject<number>;
  ingestNovaLoadRef: RefObject<(sample: NovaLoadSample) => void>;
}) {
  useEffect(() => {
    if (hidden || orbOptedOut) return;
    let alive = true;
    const tick = async () => {
      try {
        const r = await fetch("/api/nova-load", { cache: "no-store" });
        if (!r.ok) {
          // Drop the body explicitly: an unread response keeps its data pipe --
          // and the descriptor behind it -- alive until garbage collection.
          await r.body?.cancel();
          return;
        }
        const data = (await r.json()) as LoadResponse;
        if (!alive) return;
        const load = Math.max(0, Math.min(1, Number(data.load) || 0));
        targetLoadRef.current = load;
        // Host modules read this same sample rather than opening a second poll.
        // The hook drops it unless a host module is selected.
        ingestNovaLoadRef.current({
          cpu: Number(data.cpu) || 0,
          gpu: Number(data.gpu) || 0,
          net: Number(data.net) || 0,
          load,
          listening: Boolean(data.listening),
          ts: Date.now(),
        });
      } catch {
        // ignore — keep previous target
      }
    };
    tick();
    const id = setInterval(tick, POLL_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [hidden, orbOptedOut]);
}
