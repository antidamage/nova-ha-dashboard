"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { WashHistory } from "../../../../../lib/power";

/** How often the block on show is read again while the card is on screen. */
export const WASH_REFRESH_MS = 10_000;

async function fetchWashHistory(blockMs: number | null): Promise<WashHistory> {
  const query = blockMs === null ? "" : `?block=${blockMs}`;
  const response = await fetch(`/api/power/washing-machine${query}`, { cache: "no-store" });
  const payload = (await response.json()) as WashHistory & { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "Failed to read the wash history");
  return payload;
}

/**
 * The wash graph's data: the block index the buttons step through, and one block.
 *
 * The block on show is re-read on its own timer, so a wash starting or running
 * comes forward by itself, and so does the newest block when the graph is stepped
 * forward onto it — a snapshot taken before stepping away can predate an
 * attribution made since. Only the newest block's reply is kept as the follow
 * state; a block stepped back to is read into `viewed` and stays where it was put.
 * Each read carries its own sequence, so a slow reply cannot overwrite a newer
 * one. See specs/power-meters.md 5.2.
 */
export function useWashHistory({ blockMs }: { blockMs: number | null }) {
  const [newest, setNewest] = useState<WashHistory | null>(null);
  const [viewed, setViewed] = useState<WashHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const request = useRef(0);
  const mounted = useRef(true);

  const load = useCallback(async (at: number | null) => {
    const sequence = (request.current += 1);
    try {
      const history = await fetchWashHistory(at);
      if (!mounted.current || sequence !== request.current) return;
      if (at === null) setNewest(history);
      else setViewed(history);
      setError(null);
    } catch (cause) {
      if (mounted.current && sequence === request.current) {
        setError(cause instanceof Error ? cause.message : "Failed to read the wash history");
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void load(blockMs);
    const timer = window.setInterval(() => {
      if (!document.hidden) void load(blockMs);
    }, WASH_REFRESH_MS);
    return () => {
      mounted.current = false;
      window.clearInterval(timer);
    };
  }, [blockMs, load]);

  return { blocks: newest?.blocks ?? [], error, history: blockMs === null ? newest : viewed };
}
