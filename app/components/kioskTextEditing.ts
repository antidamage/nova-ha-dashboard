/**
 * Tells the kiosk that a text field is focused, so KWin's virtual keyboard is
 * not hidden out from under it.
 *
 * On Nocturnium the keyboard appears by itself when an input takes focus, and
 * `nova-monitoring/kiosk/virtual-keyboard-idle-guard.py` hides it again after
 * ten seconds of touchscreen inactivity. The guard knows nothing about focus,
 * so pausing to think mid-entry killed the keyboard. It now consults this
 * endpoint and skips the hide while a field is being typed into.
 *
 * This is a hint, not a dependency: every failure is swallowed and the caller
 * behaves identically when the endpoint is unreachable (a browser that is not
 * the kiosk, a dev server, an offline backend).
 */

const HEARTBEAT_MS = 4000;

let heartbeat: ReturnType<typeof setInterval> | null = null;
let holders = 0;

async function report(active: boolean) {
  try {
    await fetch("/api/kiosk/text-editing", {
      body: JSON.stringify({ active }),
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      method: "POST",
    });
  } catch {
    // Deliberately ignored — see the note above.
  }
}

/** Call while a text field holds focus. Returns the matching release. */
export function beginKioskTextEditing() {
  holders += 1;
  if (holders === 1) {
    void report(true);
    heartbeat = setInterval(() => { void report(true); }, HEARTBEAT_MS);
  }

  let released = false;
  return () => {
    if (released) return;
    released = true;
    holders = Math.max(0, holders - 1);
    if (holders === 0) {
      if (heartbeat !== null) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
      void report(false);
    }
  };
}

/** Test-only reset. */
export function resetKioskTextEditingForTests() {
  if (heartbeat !== null) {
    clearInterval(heartbeat);
    heartbeat = null;
  }
  holders = 0;
}
