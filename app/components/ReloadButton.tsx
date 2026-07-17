"use client";

import { RotateCw } from "lucide-react";

// Fixed top-left companion to the top-right Config link. Icon-only; a plain
// full-page reload so the on-box kiosk (which never self-reloads) can be kicked
// back to a fresh bundle without SSH. Shares the config-link box styling; the
// dashboard-reload-link class just flips it to the left edge and squares it off.
export function ReloadButton() {
  return (
    <button
      type="button"
      className="dashboard-config-link dashboard-reload-link"
      aria-label="Reload page"
      data-demo-tooltip-title="Reload"
      data-demo-tooltip="Reload the dashboard page."
      onClick={() => window.location.reload()}
    >
      <RotateCw className="h-5 w-5" aria-hidden="true" />
    </button>
  );
}
