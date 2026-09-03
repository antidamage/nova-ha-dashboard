"use client";

import { RefreshCw, ScanFace } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { ConfigAccordion } from "./ConfigControls";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

/**
 * Recent visits to the wall panel: who was there, when, and what they did.
 *
 * Grouped by SESSION rather than by action, and it is the same grouping the
 * Discord digest sends, so the two can never disagree about what happened.
 *
 * "Unidentified" is shown plainly where there is no match. `/identify` answers
 * `null` for a face it does not know rather than a nearest neighbour, and this
 * panel must not soften that into a guess — see `specs/kiosk-attribution.md`
 * § Consent scope.
 *
 * Reads the gated `/api/kiosk/witness/activity`.
 */

type KioskAction = { at: string; service: string; event: string; summary: string };

type KioskSession = {
  sessionId: string;
  person: string | null;
  score: number | null;
  identifiedAt: string | null;
  openedAt: string;
  lastTouchAt: string;
  actions: KioskAction[];
  open: boolean;
};

function timeOfDay(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay ? "" : date.toLocaleDateString([], { day: "numeric", month: "short" });
}

/** "14:02" for an instant, "14:02–14:05" for a visit that spanned minutes. */
function span(session: KioskSession): string {
  const start = timeOfDay(session.openedAt);
  const end = timeOfDay(session.lastTouchAt);
  const day = dayLabel(session.openedAt);
  const range = start === end ? start : `${start}–${end}`;
  return day ? `${day} ${range}` : range;
}

export function KioskActivityConfig() {
  const [sessions, setSessions] = useState<KioskSession[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/kiosk/witness/activity", { cache: "no-store" });
      if (!response.ok) {
        setError(
          response.status === 403
            ? "Kiosk activity needs a signed-in session on the HTTPS address."
            : "The activity log is not available.",
        );
        return;
      }
      const payload = (await response.json()) as { sessions?: KioskSession[] };
      setSessions(Array.isArray(payload.sessions) ? payload.sessions : []);
      setError(null);
    } catch {
      setError("The activity log is not available.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <ConfigAccordion id="kiosk-activity" title="Wall panel activity" icon={<ScanFace className="h-4 w-4" />}>
      <div className="grid gap-3">
        <p className="text-xs text-neutral-500">
          Who has used the wall panel, grouped by visit. People are recognised only if they are
          enrolled for face sign-in; anyone else is shown as unidentified.
        </p>

        <div>
          <MomentaryFeedbackButton
            type="button"
            className="config-page-button"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            Refresh
          </MomentaryFeedbackButton>
        </div>

        {error ? <p className="text-sm text-red-300">{error}</p> : null}

        {sessions && sessions.length === 0 && !error ? (
          <p className="text-sm text-neutral-400">Nobody has used the wall panel yet.</p>
        ) : null}

        {sessions?.map((session) => (
          <div key={session.sessionId} className="border border-neutral-800 bg-black/30 p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-semibold text-cyan-200">
                {session.person ?? "Unidentified"}
              </span>
              <span className="font-mono text-xs text-neutral-500">
                {span(session)}
                {session.open ? " · still there" : ""}
              </span>
            </div>

            {session.actions.length === 0 ? (
              <p className="mt-1 text-xs text-neutral-500">Nothing was changed.</p>
            ) : (
              <ul className="mt-2 grid gap-1">
                {session.actions.map((entry, index) => (
                  <li key={`${session.sessionId}-${index}`} className="flex gap-2 text-xs text-neutral-300">
                    <span className="font-mono text-neutral-500">{timeOfDay(entry.at)}</span>
                    <span>{entry.summary}</span>
                  </li>
                ))}
              </ul>
            )}

            {/* The match score is shown for an identified visit so a weak
                recognition reads as weak rather than as a flat assertion. */}
            {session.person && typeof session.score === "number" ? (
              <p className="mt-2 font-mono text-[10px] uppercase tracking-widest text-neutral-600">
                match {session.score.toFixed(2)}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </ConfigAccordion>
  );
}
