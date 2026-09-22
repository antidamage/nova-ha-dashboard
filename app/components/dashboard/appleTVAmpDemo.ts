"use client";

/**
 * Demo mode's storage for the amplifier dial (Adeline, 2026-09-22).
 *
 * The e2e harness runs the dashboard with no host behind `/api`, exactly as the
 * lighting rules client does, so everything the dial holds — the preset list,
 * the reading, the mute — is kept in sessionStorage instead. Its own module
 * because the store is close to the repo's file-size cap and this is a
 * self-contained job (specs/agent-token-footprint.md).
 */

export const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

const DEMO_KEY = "nova.dashboard.demoAppleTVAmp.v1";

/** Whatever the demo store holds, as the shape it was written as. */
export function readDemoAmpState<T>(): Partial<T> {
  try {
    const raw = window.sessionStorage.getItem(DEMO_KEY);
    const parsed = raw ? JSON.parse(raw) as Partial<T> : null;
    if (parsed) return parsed;
  } catch {
    // An unreadable demo store starts at the shipped defaults.
  }
  return {};
}

export function writeDemoAmpState<T>(next: Partial<T>): void {
  try {
    window.sessionStorage.setItem(DEMO_KEY, JSON.stringify({ ...readDemoAmpState<T>(), ...next }));
  } catch {
    // Demo persistence is best effort.
  }
}
