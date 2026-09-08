"use client";

/**
 * Which design is active, on the client.
 *
 * The server is authoritative (`preferences.design.activeId`); localStorage is
 * only a read cache so a reload does not wait on the network to know what to
 * paint. The pre-paint bootstrap script sets `window.__NOVA_DESIGN__` and the
 * `data-nova-design` attribute before React runs — see
 * specs/design-modules.md, "Resolving the active design".
 */
import { useEffect, useState } from "react";
import { subscribeToDashboardEvents } from "../components/sharedDashboardEvents";
import { DEFAULT_DESIGN_ID, isKnownDesignId } from "./registry";

const DESIGN_STORAGE_KEY = "nova.dashboard.design.v1";
export const DESIGN_CHANGE_EVENT = "nova-design-change";

declare global {
  interface Window {
    __NOVA_DESIGN__?: string;
  }
}

/** Reads the id the bootstrap resolved, falling back through cache to default. */
export function readActiveDesignId(): string {
  if (typeof window === "undefined") {
    return DEFAULT_DESIGN_ID;
  }
  const fromBootstrap = window.__NOVA_DESIGN__;
  if (isKnownDesignId(fromBootstrap)) {
    return fromBootstrap;
  }
  try {
    const cached = window.localStorage.getItem(DESIGN_STORAGE_KEY);
    if (isKnownDesignId(cached)) {
      return cached;
    }
  } catch {
    // Private mode or blocked storage: the default is a correct answer.
  }
  return DEFAULT_DESIGN_ID;
}

function cacheDesignId(id: string) {
  try {
    window.localStorage.setItem(DESIGN_STORAGE_KEY, id);
  } catch {
    // Caching is an optimisation; failing to cache must never fail a switch.
  }
}

/** Applies the id everywhere the DOM needs it, then tells listeners. */
export function applyActiveDesignId(id: string) {
  window.__NOVA_DESIGN__ = id;
  document.documentElement.setAttribute("data-nova-design", id);
  cacheDesignId(id);
  window.dispatchEvent(new CustomEvent(DESIGN_CHANGE_EVENT, { detail: id }));
}

/** Writes the shared choice, then applies it locally. */
export async function saveActiveDesignId(id: string): Promise<void> {
  const response = await fetch("/api/design", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ activeId: id }),
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error ?? "Could not save the design");
  }
  const payload = (await response.json()) as { activeId?: string };
  applyActiveDesignId(isKnownDesignId(payload.activeId) ? payload.activeId : id);
}

/**
 * Returns the default on the server and on the first client render, then the
 * real id once mounted. That two-step is deliberate: `app/page.tsx` is static,
 * so SSR cannot know the answer, and SPEC.md §2 requires the first client
 * render to match the server rather than reading client-only state inline.
 */
export function useActiveDesignId(): string {
  const [id, setId] = useState<string>(DEFAULT_DESIGN_ID);

  useEffect(() => {
    setId(readActiveDesignId());

    const onChange = (event: Event) => {
      const next = (event as CustomEvent<string>).detail;
      setId(isKnownDesignId(next) ? next : DEFAULT_DESIGN_ID);
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === DESIGN_STORAGE_KEY) {
        setId(readActiveDesignId());
      }
    };

    // The design is one shared household setting, so a change made on any
    // screen has to reach the others. Without this the kiosk keeps rendering
    // the old presentation until somebody reloads it. Riding the existing
    // shared EventSource matters: opening another one would cost a connection
    // from the browser's ~6-per-origin budget, which this dashboard has
    // already starved once (see sharedDashboardEvents.ts).
    const unsubscribe = subscribeToDashboardEvents({
      design: (event) => {
        let next: unknown;
        try {
          next = (JSON.parse(event.data) as { activeId?: unknown }).activeId;
        } catch {
          return;
        }
        // An id this build does not know about is ignored rather than applied:
        // a half-deployed house should keep rendering something.
        if (!isKnownDesignId(next) || next === readActiveDesignId()) {
          return;
        }
        applyActiveDesignId(next);
      },
    });

    window.addEventListener(DESIGN_CHANGE_EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      unsubscribe();
      window.removeEventListener(DESIGN_CHANGE_EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  return id;
}
