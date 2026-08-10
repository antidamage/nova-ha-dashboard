"use client";

import { AlertTriangle, Cat, Check, CheckSquare2, Clock3, Dog, Eye, ListChecks, Loader2, PersonStanding, Square, Star, Trash2, Video } from "lucide-react";
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
  retainedReason?: string | null;
  alertReason?: string | null;
  behaviorConfidence?: number | null;
  ownerPresent?: boolean;
  policyVersion?: number | null;
};

type AnalysisStatus = {
  ok: boolean;
  backlogSeconds: number;
  queueDepth: number;
  detectorError?: string | null;
  detailError?: string | null;
  policyConfigured?: boolean;
  policyVersion?: number;
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
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [selecting, setSelecting] = useState(false);

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

  const toggleForDelete = useCallback((eventId: string) => {
    setSelectedForDelete((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  }, []);

  const bulkDelete = useCallback(async () => {
    const ids = [...selectedForDelete];
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected events and their recorded clips? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/camera/${cameraId}/events`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error("Could not delete the selected events.");
      const payload = (await response.json()) as { deleted: string[] };
      const deleted = new Set(payload.deleted);
      setEvents((current) => current.filter((event) => !deleted.has(event.id)));
      if (selectedId && deleted.has(selectedId)) setSelectedId(null);
      setSelectedForDelete(new Set());
      setMessage(`${deleted.size} events deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete the selected events.");
    } finally {
      setDeleting(false);
    }
  }, [cameraId, selectedForDelete, selectedId]);

  return (
    <div className="camera-event-report">
      <button type="button" className="camera-event-report-header" onClick={() => { setOpen(true); void refresh(true); }}>
        <span className="camera-event-report-heading"><Eye className="h-4 w-4" aria-hidden="true" /> Recent activity</span>
        <span className={classNames("camera-event-report-health", status && !status.ok && "is-error")}>
          {importantCount ? `${importantCount} important` : status?.queueDepth ? `${status.queueDepth} queued` : "View events"}
        </span>
      </button>
      {status?.policyConfigured === false ? <p className="camera-event-empty"><AlertTriangle className="h-4 w-4" /> Private camera policy unavailable; candidates are being retained for review.</p> : null}
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
          <span className="camera-event-bulk-spacer" />
          <button type="button" className={selecting ? "is-active" : ""} onClick={() => setSelecting((value) => !value)}><ListChecks className="h-4 w-4" /> Select</button>
          {selecting ? <button type="button" onClick={() => setSelectedForDelete(new Set(visible.map((event) => event.id)))}>All visible</button> : null}
          {selectedForDelete.size ? <button type="button" onClick={() => setSelectedForDelete(new Set())}>Clear</button> : null}
          <button type="button" className="is-danger" disabled={!selectedForDelete.size || deleting} onClick={() => void bulkDelete()}>
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />} Delete {selectedForDelete.size || "selected"}
          </button>
        </div>
        <div className="camera-events-workspace">
          <aside className="camera-events-list" aria-label="Camera events">
            {visible.map((event) => (
              <button key={event.id} type="button" className={classNames("camera-events-list-row", selecting && "is-selecting", selected?.id === event.id && "is-selected", selectedForDelete.has(event.id) && "is-checked", `is-${event.priority}`)} onClick={() => selecting ? toggleForDelete(event.id) : setSelectedId(event.id)}>
                {selecting ? <span className="camera-event-select-indicator">{selectedForDelete.has(event.id) ? <CheckSquare2 className="h-5 w-5" /> : <Square className="h-5 w-5" />}</span> : null}
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
                  <div><dt>Retained because</dt><dd>{selected.retainedReason?.replaceAll("_", " ") || "Fail-open review"}</dd></div>
                  <div><dt>Owner present</dt><dd>{selected.ownerPresent ? "High-confidence match" : "No high-confidence match"}</dd></div>
                  {selected.behaviorConfidence != null ? <div><dt>Behaviour confidence</dt><dd>{Math.round(selected.behaviorConfidence * 100)}%</dd></div> : null}
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
