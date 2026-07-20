"use client";

import { Download, Loader2, RefreshCw, RotateCcw, Search } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { ConfigAccordion } from "./ConfigControls";
import { classNames } from "./dashboard/shared";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { useSettingCooldown } from "./useSettingCooldown";

type UpdateStatus = {
  channel: { repo: string; branch: string };
  currentShortSha: string | null;
  deployedAt: string | null;
  latestShortSha: string | null;
  latestMessage: string | null;
  updateAvailable: boolean;
  autoUpdate: boolean;
  canRollback: boolean;
  previousSha: string | null;
  phase: string;
  phaseMessage: string | null;
  lastCheckedAt: string | null;
  checkOk: boolean;
  checkError: string | null;
  busy: boolean;
};

const POLL_INTERVAL_MS = 30_000;

function formatTime(value: string | null): string {
  if (!value) {
    return "never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

function shortSha(value: string | null): string {
  return value ? value.slice(0, 7) : "—";
}

export function UpdateConfig({ initialAutoUpdate }: { initialAutoUpdate?: boolean }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [autoUpdate, setAutoUpdate] = useState<boolean>(initialAutoUpdate ?? true);
  const [message, setMessage] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const [rollingBack, setRollingBack] = useState(false);
  const [applying, setApplying] = useState(false);
  const timerRef = useRef<number | null>(null);
  // Guard the Auto-Update toggle from being reverted by the 30s poll for a few
  // seconds after the user flips it (same rubber-band guard as the sliders).
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const applyStatus = useCallback((next: UpdateStatus) => {
    setStatus(next);
    setAutoUpdate(next.autoUpdate);
  }, []);

  const load = useCallback(async () => {
    if (isCoolingDown()) {
      return;
    }
    try {
      const response = await fetch("/api/update", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      if (!isCoolingDown()) {
        applyStatus((await response.json()) as UpdateStatus);
      }
    } catch {
      // endpoint absent or offline — leave last known state.
    }
  }, [applyStatus, isCoolingDown]);

  useEffect(() => {
    void load();
    timerRef.current = window.setInterval(() => void load(), POLL_INTERVAL_MS);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [load]);

  const checkForUpdates = useCallback(async () => {
    setChecking(true);
    setMessage(null);
    try {
      const response = await fetch("/api/update/check", { method: "POST" });
      const payload = (await response.json().catch(() => null)) as UpdateStatus | { error?: string } | null;
      if (payload && "channel" in payload) {
        applyStatus(payload);
        setMessage(
          payload.updateAvailable
            ? `Update available: ${shortSha(payload.latestShortSha)}.`
            : payload.checkOk
              ? "Up to date."
              : payload.checkError ?? "Check failed.",
        );
      } else {
        setMessage(payload?.error ?? "Check failed.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Check failed.");
    } finally {
      setChecking(false);
    }
  }, [applyStatus]);

  const applyUpdate = useCallback(async () => {
    setApplying(true);
    setMessage(null);
    try {
      const response = await fetch("/api/update/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: "config" }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { status?: UpdateStatus; error?: string }
        | null;
      if (payload?.status) {
        applyStatus(payload.status);
      }
      setMessage(
        response.ok
          ? "Update queued — building the new version…"
          : payload?.error ?? "Could not start the update.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not start the update.");
    } finally {
      setApplying(false);
    }
  }, [applyStatus]);

  const reinstallPrevious = useCallback(async () => {
    setRollingBack(true);
    setMessage(null);
    try {
      const response = await fetch("/api/update/rollback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ requestedBy: "config" }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { status?: UpdateStatus; error?: string }
        | null;
      if (payload?.status) {
        applyStatus(payload.status);
      }
      setMessage(
        response.ok
          ? "Rolling back to the previous version…"
          : payload?.error ?? "Rollback failed.",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rollback failed.");
    } finally {
      setRollingBack(false);
    }
  }, [applyStatus]);

  const toggleAutoUpdate = useCallback(async () => {
    markInteraction();
    const next = !autoUpdate;
    setAutoUpdate(next); // optimistic
    try {
      const response = await fetch("/api/update/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autoUpdate: next }),
      });
      if (response.ok) {
        applyStatus((await response.json()) as UpdateStatus);
      } else {
        setAutoUpdate(!next); // revert on failure
      }
    } catch {
      setAutoUpdate(!next);
    }
  }, [autoUpdate, applyStatus, markInteraction]);

  const busy = status?.busy ?? false;
  const updateAvailable = status?.updateAvailable ?? false;

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

        <div className="climate-switch-row border">
          <span className="climate-switch-label">Auto-update</span>
          <MomentaryFeedbackButton
            type="button"
            className={classNames("cyber-switch", autoUpdate && "cyber-switch-checked")}
            role="switch"
            aria-checked={autoUpdate}
            aria-label="Install updates automatically"
            onClick={() => void toggleAutoUpdate()}
          >
            <span className="cyber-switch-thumb" />
          </MomentaryFeedbackButton>
          <span className="climate-switch-label">{autoUpdate ? "On" : "Off"}</span>
        </div>

        {message ? <p className="text-sm font-semibold text-neutral-300">{message}</p> : null}
      </div>
    </ConfigAccordion>
  );
}
