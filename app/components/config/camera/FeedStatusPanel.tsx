"use client";

import { RefreshCw } from "lucide-react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { DEMO_MODE, STATE_LABEL } from "./constants";
import type { CameraStatus } from "./types";

// The live device state (streaming / test-pattern / stalled / absent …), the
// human "why", and the destructive re-initialise entry point.
export function FeedStatusPanel({
  reinitBusy,
  reinitMessage,
  setConfirmStage,
  status,
}: {
  reinitBusy: boolean;
  reinitMessage: string | null;
  setConfirmStage: (stage: 0 | 1 | 2) => void;
  status: CameraStatus | null;
}) {
  return (
    <div className="grid gap-2 border border-cyan-300/20 bg-neutral-900/70 p-3">
      <span className="text-sm font-black uppercase text-cyan-200">Feed status</span>
      {(() => {
        const meta = status ? STATE_LABEL[status.deviceState] : null;
        const dotColor = !status
          ? "#64748b"
          : meta?.tone === "ok"
            ? "#34d399"
            : meta?.tone === "warn"
              ? "#fbbf24"
              : "#f87171";
        return (
          <>
            <span className="flex items-center gap-2 text-sm font-semibold text-neutral-100">
              <span
                aria-hidden="true"
                style={{ width: 10, height: 10, borderRadius: 9999, background: dotColor, display: "inline-block" }}
              />
              {status ? meta?.label ?? status.deviceState : "Checking…"}
              {status?.newestSegmentAgeSeconds != null ? (
                <span className="font-mono text-xs text-neutral-500">({status.newestSegmentAgeSeconds}s ago)</span>
              ) : null}
            </span>
            {status?.statusReason ? (
              <span className="text-xs text-neutral-400">{status.statusReason}</span>
            ) : null}
          </>
        );
      })()}
      <div className="mt-1 flex items-center gap-3">
        <MomentaryFeedbackButton
          type="button"
          className="config-page-button flex items-center gap-2"
          disabled={DEMO_MODE || reinitBusy}
          onClick={() => setConfirmStage(1)}
        >
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          Re-initialise Camera
        </MomentaryFeedbackButton>
        {reinitMessage ? <span className="text-xs text-cyan-200">{reinitMessage}</span> : null}
      </div>
    </div>
  );
}
