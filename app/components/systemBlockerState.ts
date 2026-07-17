// Tiny shared flag so the global SystemActivityBlocker stays dormant while a
// page-level blocker (SystemControlConfig's restart/reboot overlay) is already
// covering this same client — otherwise the initiating device would stack two
// identical overlays. Module-level state is per-browser-tab, which is exactly
// the scope we want.
let active = 0;

export function beginExplicitBlocker() {
  active += 1;
}

export function endExplicitBlocker() {
  active = Math.max(0, active - 1);
}

export function explicitBlockerActive() {
  return active > 0;
}
