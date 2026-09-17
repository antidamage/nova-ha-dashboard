"use client";

import { Download, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import { ConfigAccordion } from "../../ConfigControls";
import { classNames } from "../../dashboard/shared";
import { SwitchRow } from "../../SlideSwitch";
import { formatTime, shortSha } from "./update-model";
import { useUpdateStatus } from "./useUpdateStatus";

export function UpdateConfig({ initialAutoUpdate }: { initialAutoUpdate?: boolean }) {
  const {
    applyUpdate,
    applying,
    autoUpdate,
    busy,
    checkForUpdates,
    checking,
    message,
    reinstallPrevious,
    rollingBack,
    showUpdatesOnHome,
    status,
    toggleAutoUpdate,
    toggleShowUpdatesOnHome,
    updateAvailable,
  } = useUpdateStatus(initialAutoUpdate);

  return (
    <ConfigAccordion
      id="updates"
      title="Updates"
      icon={<RefreshCw className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      defaultOpen={updateAvailable || busy}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <div className="grid gap-4 text-sm">
        <div className="grid gap-2">
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-2">
            <span className="font-black uppercase text-neutral-100">Installed version</span>
            <span className="font-mono text-neutral-300">{shortSha(status?.currentShortSha ?? null)}</span>
          </div>
          <div className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-2">
            <span className="font-black uppercase text-neutral-100">Latest on {status?.channel.branch ?? "main"}</span>
            <span className={classNames("font-mono", status?.updateAvailable ? "text-cyan-200" : "text-neutral-300")}>
              {shortSha(status?.latestShortSha ?? null)}
            </span>
          </div>
          {status?.latestMessage ? (
            // Fixed monospace content font (matches the sha/repo spans) rather than the
            // themable title font this <p> would otherwise inherit.
            <p className="font-mono text-xs text-neutral-500">{status.latestMessage}</p>
          ) : null}
          <p className="text-xs text-neutral-500">
            Tracking <span className="font-mono">{status?.channel.repo ?? "—"}</span> · last checked {formatTime(status?.lastCheckedAt ?? null)}
          </p>
          {status?.phaseMessage && status.phase !== "idle" && status.phase !== "success" ? (
            <p className="text-xs font-semibold text-cyan-200">{status.phaseMessage}</p>
          ) : null}
        </div>

        <div className="config-import-export-actions">
          {updateAvailable ? (
            <button
              type="button"
              className="config-page-button config-page-button-primary"
              disabled={applying || busy}
              onClick={() => void applyUpdate()}
            >
              {applying || busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              Update to {shortSha(status?.latestShortSha ?? null)}
            </button>
          ) : null}
          <button
            type="button"
            className="config-page-button"
            disabled={checking || busy}
            onClick={() => void checkForUpdates()}
          >
            {checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Check for updates
          </button>
          <button
            type="button"
            className="config-page-button"
            disabled={!status?.canRollback || rollingBack || busy}
            onClick={() => void reinstallPrevious()}
          >
            {rollingBack ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            Reinstall previous version
          </button>
        </div>

        <SwitchRow
          checked={autoUpdate}
          label="Auto-update"
          detail="Install updates automatically"
          onChange={() => void toggleAutoUpdate()}
        />

        <SwitchRow
          checked={showUpdatesOnHome}
          label="Show updates on home page"
          onChange={() => void toggleShowUpdatesOnHome()}
        />

        {message ? <p className="text-sm font-semibold text-neutral-300">{message}</p> : null}
      </div>
    </ConfigAccordion>
  );
}
