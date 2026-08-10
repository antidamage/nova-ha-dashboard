"use client";

import { AlertTriangle, Cat, Check, Clock3, Dog, Eye, Loader2, PersonStanding, Star, Trash2, Video } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ModalOverlay } from "../ModalOverlay";
import { classNames } from "./shared";

export type CameraEvent = {
  id: string;
  cameraId: string;
  startedAt: string;
  endedAt: string | null;
  status: "collecting" | "queued" | "analysing" | "analysed" | "analysis_failed";
  priority: "routine" | "important" | "urgent";
  title: string;
  summary: string;
  zones: string[];
  labels: string[];
  subjects: Array<{ class: string; confidence: number; zone: string; box: number[]; identity?: string; identityConfidence?: number; identityTentative?: boolean }>;
  thumbnailUrl: string | null;
  clipUrl: string | null;
  reviewed: boolean;
  starred: boolean;
  alertState: string;
  detailError?: string | null;
};

type AnalysisStatus = {
  ok: boolean;
  backlogSeconds: number;
  queueDepth: number;
  detectorError?: string | null;
  detailError?: string | null;
};

function when(value: string) {
  const date = new Date(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function statusLabel(status: CameraEvent["status"]) {
  if (status === "collecting") return "Recording";
  if (status === "queued") return "Detail queued";
  if (status === "analysing") return "Analysing";
  if (status === "analysis_failed") return "Detail failed";
  return "Analysed";
}

function SubjectIcon({ event }: { event: CameraEvent }) {
  if (event.labels.includes("dog")) return <Dog className="h-4 w-4" aria-hidden="true" />;
  if (event.labels.includes("cat")) return <Cat className="h-4 w-4" aria-hidden="true" />;
  if (event.labels.includes("person")) return <PersonStanding className="h-4 w-4" aria-hidden="true" />;
  return <Eye className="h-4 w-4" aria-hidden="true" />;
}

async function readEvents(cameraId: string, limit: number) {
  const response = await fetch(`/api/camera/${cameraId}/events?limit=${limit}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Camera analysis is unavailable");
  return (await response.json()) as { events: CameraEvent[] };
}

export function CameraEventReport({ cameraId }: { cameraId: string }) {
  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "important" | "animals" | "unreviewed">("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);

  const refresh = useCallback(async (full = false) => {
    try {
      const payload = await readEvents(cameraId, full || open ? 100 : 5);
      setEvents(payload.events);
      if (!selectedId && payload.events[0]) setSelectedId(payload.events[0].id);
      setMessage(null);
      const statusResponse = await fetch(`/api/camera/${cameraId}/analysis/status`, { cache: "no-store" });
      if (statusResponse.ok) setStatus((await statusResponse.json()) as AnalysisStatus);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Camera analysis is unavailable");
    } finally {
      setLoading(false);
    }
  }, [cameraId, open, selectedId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), open ? 10_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  const visible = useMemo(() => events.filter((event) => {
    if (filter === "important") return event.priority !== "routine";
    if (filter === "animals") return event.labels.some((label) => ["cat", "dog", "horse", "sheep", "cow"].includes(label));
    if (filter === "unreviewed") return !event.reviewed;
    return true;
  }), [events, filter]);
  const selected = events.find((event) => event.id === selectedId) ?? visible[0] ?? null;
  const recent = events.slice(0, 5);
  const importantCount = events.filter((event) => event.priority !== "routine" && !event.reviewed).length;

  const patchEvent = useCallback(async (eventId: string, patch: Partial<Pick<CameraEvent, "reviewed" | "starred">>) => {
    const response = await fetch(`/api/camera/${cameraId}/events/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      setMessage("Could not update that event.");
      return;
    }
    const updated = (await response.json()) as CameraEvent;
    setEvents((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, [cameraId]);

  const deleteEvent = useCallback(async (eventId: string) => {
    if (!window.confirm("Delete this event and its recorded clip? This cannot be undone.")) return;
    const response = await fetch(`/api/camera/${cameraId}/events/${eventId}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Could not delete that event.");
      return;
    }
    setEvents((current) => current.filter((item) => item.id !== eventId));
    setSelectedId(null);
  }, [cameraId]);

  return (
    <div className="camera-event-report">
      <button type="button" className="camera-event-report-header" onClick={() => { setOpen(true); void refresh(true); }}>
        <span className="camera-event-report-heading"><Eye className="h-4 w-4" aria-hidden="true" /> Recent activity</span>
        <span className={classNames("camera-event-report-health", status && !status.ok && "is-error")}>
          {importantCount ? `${importantCount} important` : status?.queueDepth ? `${status.queueDepth} queued` : "View events"}
        </span>
      </button>
      {loading ? (
        <p className="camera-event-empty"><Loader2 className="h-4 w-4 animate-spin" /> Loading activity…</p>
      ) : message && events.length === 0 ? (
        <p className="camera-event-empty">{message}</p>
      ) : recent.length === 0 ? (
        <p className="camera-event-empty">No daytime activity recorded yet.</p>
      ) : (
        <div className="camera-event-mini-list">
          {recent.map((event) => (
            <button key={event.id} type="button" className={classNames("camera-event-mini-row", `is-${event.priority}`, !event.reviewed && "is-unreviewed")} onClick={() => { setSelectedId(event.id); setOpen(true); void refresh(true); }}>
              <SubjectIcon event={event} />
              <span className="camera-event-mini-copy"><strong>{event.title}</strong><small>{when(event.startedAt)} · {event.zones.join(", ")}</small></span>
              <span className="camera-event-mini-status">{statusLabel(event.status)}</span>
            </button>
          ))}
        </div>
      )}

      <ModalOverlay open={open} onClose={() => setOpen(false)} ariaLabelledBy="camera-events-title" className="camera-events-modal">
        <header className="camera-events-modal-header">
          <div><p className="camera-events-kicker">Outside camera</p><h2 id="camera-events-title">Event review</h2></div>
          <button type="button" className="camera-events-close" onClick={() => setOpen(false)}>Close</button>
        </header>
        <div className="camera-event-filters" aria-label="Event filters">
          {(["all", "important", "animals", "unreviewed"] as const).map((value) => (
            <button key={value} type="button" className={filter === value ? "is-active" : ""} onClick={() => setFilter(value)}>{value}</button>
          ))}
        </div>
        <div className="camera-events-workspace">
          <aside className="camera-events-list" aria-label="Camera events">
            {visible.map((event) => (
              <button key={event.id} type="button" className={classNames("camera-events-list-row", selected?.id === event.id && "is-selected", `is-${event.priority}`)} onClick={() => setSelectedId(event.id)}>
                {event.thumbnailUrl ? <img src={event.thumbnailUrl} alt="" /> : <span className="camera-event-no-thumb"><Video className="h-5 w-5" /></span>}
                <span><strong>{event.title}</strong><small>{when(event.startedAt)}</small><small>{event.zones.join(" · ")}</small></span>
              </button>
            ))}
          </aside>
          <section className="camera-event-detail">
            {selected ? (
              <>
                <div className="camera-event-detail-title">
                  <div><span className={classNames("camera-event-priority", `is-${selected.priority}`)}>{selected.priority}</span><h3>{selected.title}</h3><p>{when(selected.startedAt)} · {statusLabel(selected.status)}</p></div>
                  <div className="camera-event-actions">
                    <button type="button" className={selected.reviewed ? "is-active" : ""} onClick={() => void patchEvent(selected.id, { reviewed: !selected.reviewed })}><Check className="h-4 w-4" /> Reviewed</button>
                    <button type="button" className={selected.starred ? "is-active" : ""} onClick={() => void patchEvent(selected.id, { starred: !selected.starred })}><Star className="h-4 w-4" /> Star</button>
                    <button type="button" className="is-danger" onClick={() => void deleteEvent(selected.id)}><Trash2 className="h-4 w-4" /> Delete</button>
                  </div>
                </div>
                {selected.clipUrl ? <video className="camera-event-video" src={selected.clipUrl} controls playsInline preload="metadata" /> : selected.thumbnailUrl ? <img className="camera-event-image" src={selected.thumbnailUrl} alt="Recorded camera event" /> : null}
                <div className="camera-event-summary"><h4>Analysis</h4><p>{selected.summary}</p>{selected.detailError ? <p className="camera-event-error"><AlertTriangle className="h-4 w-4" /> {selected.detailError}</p> : null}</div>
                <dl className="camera-event-evidence">
                  <div><dt>Subjects</dt><dd>{selected.subjects.map((item) => `${item.identity ? `possibly ${item.identity} · ` : ""}${item.class} ${Math.round(item.confidence * 100)}%`).join(", ") || "Unknown"}</dd></div>
                  <div><dt>Zones</dt><dd>{selected.zones.join(", ")}</dd></div>
                  <div><dt>Labels</dt><dd>{selected.labels.join(", ")}</dd></div>
                  <div><dt>Alert</dt><dd>{selected.alertState}</dd></div>
                </dl>
              </>
            ) : <p className="camera-event-empty"><Clock3 className="h-4 w-4" /> Select an event to review.</p>}
          </section>
        </div>
      </ModalOverlay>
    </div>
  );
}
