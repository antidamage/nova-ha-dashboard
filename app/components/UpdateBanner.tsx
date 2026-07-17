"use client";

import { Download, Loader2, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

type UpdateStatus = {
  currentShortSha: string | null;
  latestShortSha: string | null;
  latestMessage: string | null;
  updateAvailable: boolean;
  phase: string;
  phaseMessage: string | null;
  busy: boolean;
};

const POLL_INTERVAL_MS = 5 * 60_000;
const BUSY_POLL_INTERVAL_MS = 5_000;
const DISMISS_KEY = "nova.update.dismissedSha";

const PHASE_LABELS: Record<string, string> = {
  queued: "Update queued…",
  checking: "Checking for updates…",
  building: "Building the new version…",
  restarting: "Restarting the dashboard…",
  verifying: "Verifying the new version…",
  rolledback: "Update failed — rolled back to the previous version.",
  failed: "Update failed.",
};

// Ordered phases for the progress bar shown in the large updating banner.
const PROGRESS_PHASES = ["queued", "checking", "building", "restarting", "verifying"];

const isDemo = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

export function UpdateBanner({ context = "dashboard" }: { context?: "dashboard" | "config" }) {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [dismissedSha, setDismissedSha] = useState<string | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    try {
      setDismissedSha(sessionStorage.getItem(DISMISS_KEY));
    } catch {
      // sessionStorage unavailable — ignore.
    }
  }, []);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/update", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      setStatus((await response.json()) as UpdateStatus);
    } catch {
      // Offline or endpoint absent (e.g. demo export) — leave banner hidden.
    }
  }, []);

  useEffect(() => {
    if (isDemo) {
      return;
    }
    void load();
  }, [load]);

  // Poll faster while an update is in flight so progress stays live.
  useEffect(() => {
    if (isDemo) {
      return;
    }
    const interval = status?.busy ? BUSY_POLL_INTERVAL_MS : POLL_INTERVAL_MS;
    timerRef.current = window.setInterval(() => void load(), interval);
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
    };
  }, [load, status?.busy]);

  const dismiss = useCallback(() => {
    const sha = status?.latestShortSha ?? null;
    setDismissedSha(sha);
    try {
      if (sha) {
        sessionStorage.setItem(DISMISS_KEY, sha);
      }
    } catch {
      // ignore
    }
  }, [status?.latestShortSha]);

  if (isDemo || !status) {
    return null;
  }

  const isBusy = status.busy;
  const terminalFailure = status.phase === "failed" || status.phase === "rolledback";
  // The "available" prompt is the dashboard's job; on the config page the
  // Updates section already offers the button, so don't double up there.
  const updateOffered =
    context === "dashboard" && status.updateAvailable && status.latestShortSha !== dismissedSha;

  if (!isBusy && !terminalFailure && !updateOffered) {
    return null;
  }

  const phaseLabel = PHASE_LABELS[status.phase];

  // Large, prominent banner while an update is actually running.
  if (isBusy) {
    const stepIndex = PROGRESS_PHASES.indexOf(status.phase);
    const progressPct = stepIndex >= 0 ? ((stepIndex + 1) / (PROGRESS_PHASES.length + 1)) * 100 : 10;
    return (
      <div className="update-banner update-banner-lg" role="status" aria-live="polite">
        <div className="update-banner-lg-row">
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
          <span className="update-banner-lg-title">{status.phaseMessage ?? phaseLabel ?? "Updating…"}</span>
          {status.latestShortSha ? (
            <span className="update-banner-sha">{status.latestShortSha}</span>
          ) : null}
        </div>
        <div className="update-banner-progress" aria-hidden="true">
          <div className="update-banner-progress-fill" style={{ width: `${progressPct}%` }} />
        </div>
      </div>
    );
  }

  if (terminalFailure) {
    return (
      <div className="update-banner update-banner-lg" role="status" aria-live="polite">
        <div className="update-banner-lg-row">
          <span className="update-banner-lg-title update-banner-text-warn">
            {status.phaseMessage ?? phaseLabel ?? "Update failed."}
          </span>
          <button type="button" className="update-banner-button" onClick={() => void load()}>
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </button>
        </div>
      </div>
    );
  }

  // Thin "available" prompt (dashboard only). The Update button takes the user
  // to the config Updates section, which is where the update is confirmed.
  return (
    <div className="update-banner" role="status" aria-live="polite">
      <span className="update-banner-text">
        <Download className="h-4 w-4" aria-hidden="true" />
        A new version is available
        {status.latestShortSha ? <span className="update-banner-sha"> ({status.latestShortSha})</span> : null}.
      </span>
      <Link className="update-banner-button" href="/config#updates">
        Update
      </Link>
      <button
        type="button"
        className="update-banner-dismiss"
        aria-label="Dismiss update notification"
        onClick={dismiss}
      >
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
