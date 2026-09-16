"use client";

import { AlertTriangle, Check, CheckSquare2, Clock3, Eye, ListChecks, Loader2, Square, Star, Trash2, Video } from "lucide-react";
import { ModalOverlay } from "../../ModalOverlay";
import { classNames } from "../shared";
import { statusLabel, when } from "./format-model";
import { useCameraEventReport } from "./useCameraEventReport";

export function CameraEventReport({ cameraId }: { cameraId: string }) {
  const {
    bulkDelete,
    deleteEvent,
    deleting,
    events,
    filter,
    importantCount,
    loading,
    message,
    open,
    patchEvent,
    refresh,
    selected,
    selectedForDelete,
    selecting,
    setFilter,
    setOpen,
    setSelectedForDelete,
    setSelectedId,
    setSelecting,
    status,
    toggleForDelete,
    visible,
  } = useCameraEventReport(cameraId);

  return (
    <div className="advanced-fold-row camera-event-report">
      {/* The bar, with the latest five under it again (Adeline, 2026-09-14):
          the list is the first thing in the camera's Advanced section
          (specs/advanced-fold.md), and the bar still opens the full report.
          The policy warning rides the bar. */}
      <button type="button" className="camera-event-report-header" onClick={() => { setOpen(true); void refresh(true); }}>
        <span className="camera-event-report-heading"><Eye className="h-4 w-4" aria-hidden="true" /> Recent activity</span>
        <span className={classNames("camera-event-report-health", status && !status.ok && "is-error", status?.policyConfigured === false && "is-error")}>
          {status?.policyConfigured === false
            ? <><AlertTriangle className="h-4 w-4" aria-hidden="true" /> Policy unavailable</>
            : loading
              ? <><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading…</>
              : importantCount ? `${importantCount} important` : status?.queueDepth ? `${status.queueDepth} queued` : "View events"}
        </span>
      </button>

      <div className="camera-event-preview-list">
        {events.slice(0, 5).map((event) => (
          <button
            key={event.id}
            type="button"
            className={classNames("camera-event-preview-row", `is-${event.priority}`, !event.reviewed && "is-unreviewed")}
            onClick={() => { setSelectedId(event.id); setOpen(true); void refresh(true); }}
          >
            {event.thumbnailUrl
              ? <img src={event.thumbnailUrl} alt="" />
              : <span className="camera-event-no-thumb"><Video className="h-5 w-5" aria-hidden="true" /></span>}
            <span className="camera-event-preview-text">
              <strong>{event.title}</strong>
              <small>{when(event.startedAt)}</small>
            </span>
          </button>
        ))}
        {!loading && !events.length ? <p className="camera-event-preview-empty">Nothing recorded yet.</p> : null}
      </div>

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
        {message ? <p className="camera-event-empty" role="status">{message}</p> : null}
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
