"use client";

import { Camera, ChevronDown, Download, Loader2 } from "lucide-react";
import { createPortal } from "react-dom";
import { classNames } from "../shared";
import { cameraUrl } from "../cameraHost";
import { formatBytes, formatCreated, formatDuration } from "./format-model";
import type { CameraSnapshotsState } from "./useCameraSnapshots";

/** The Saved Captures accordion in the camera panel's Advanced fold. */
export function CameraSnapshots({
  cameraId,
  hasDvr,
  state,
}: {
  cameraId: string;
  hasDvr: boolean;
  state: CameraSnapshotsState;
}) {
  const { snapshotsOpen, setSnapshotsOpen, snapshots, snapshotMax, snapshotBusy, snapshotMessage, setSnapshotMessage, setConfirmSnapshot } = state;
  return (
    <div className="advanced-fold-row camera-snapshots">
      <button
        type="button"
        className="camera-snapshots-toggle"
        aria-expanded={snapshotsOpen}
        onClick={() => setSnapshotsOpen((open) => !open)}
      >
        <ChevronDown
          className={classNames("camera-snapshots-chevron h-4 w-4", snapshotsOpen && "is-open")}
          aria-hidden="true"
        />
        <Camera className="h-4 w-4" aria-hidden="true" />
        <span className="camera-snapshots-title">Saved Captures</span>
        <span className="camera-snapshots-count">
          {snapshots.length}/{snapshotMax}
        </span>
      </button>

      {snapshotsOpen ? (
        <div className="camera-snapshots-body">
          <div className="camera-snapshots-actions">
            <button
              type="button"
              className="camera-snapshot-save"
              disabled={!hasDvr || snapshotBusy}
              onClick={() => {
                setSnapshotMessage(null);
                setConfirmSnapshot(true);
              }}
            >
              {snapshotBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              ) : (
                <Camera className="h-4 w-4" aria-hidden="true" />
              )}
              Save last 2 hours
            </button>
            {snapshotMessage ? (
              <span className="camera-snapshots-message">{snapshotMessage}</span>
            ) : null}
          </div>

          <p className="camera-snapshots-hint">
            Freezes the buffered footage to disk. Only the {snapshotMax} most recent captures are kept — saving a
            new one deletes the oldest.
          </p>

          {snapshots.length === 0 ? (
            <p className="camera-snapshots-empty">No saved captures yet.</p>
          ) : (
            <ul className="camera-snapshots-list">
              {snapshots.map((snapshot) => (
                <li key={snapshot.id} className="camera-snapshot-item">
                  <div className="camera-snapshot-meta">
                    <span className="camera-snapshot-when">{formatCreated(snapshot.createdAt)}</span>
                    <span className="camera-snapshot-size">
                      {formatDuration(snapshot.durationSeconds)} · {formatBytes(snapshot.sizeBytes)}
                    </span>
                  </div>
                  <a
                    className="camera-snapshot-download"
                    href={cameraUrl(cameraId, `snapshots/${snapshot.id}`)}
                    download
                  >
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** The confirm modal for saving a capture, portalled to the body. */
export function CameraSnapshotConfirm({ state }: { state: CameraSnapshotsState }) {
  const { confirmSnapshot, setConfirmSnapshot, snapshotBusy, snapshotMax, fireSnapshot } = state;
  if (!confirmSnapshot || typeof document === "undefined") {
    return null;
  }
  return createPortal(
    <div
      className="system-confirm-overlay"
      role="presentation"
      onClick={() => {
        if (!snapshotBusy) {
          setConfirmSnapshot(false);
        }
      }}
    >
      <div
        className="system-confirm-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="camera-snapshot-title"
        aria-describedby="camera-snapshot-body"
        onClick={(event) => event.stopPropagation()}
      >
        <span className="system-stripe system-stripe-top" aria-hidden="true" />
        <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
        <p className="system-confirm-step">Save capture</p>
        <h3 id="camera-snapshot-title" className="system-confirm-title">
          Save the last two hours?
        </h3>
        <p id="camera-snapshot-body" className="system-confirm-body">
          This writes the currently buffered footage to disk as a downloadable capture. Only the {snapshotMax}{" "}
          most recent captures are kept — saving this one deletes the oldest if there are already {snapshotMax}.
        </p>
        <div className="system-confirm-actions">
          <button
            type="button"
            className="system-confirm-cancel"
            disabled={snapshotBusy}
            onClick={() => setConfirmSnapshot(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="system-confirm-go"
            disabled={snapshotBusy}
            onClick={() => void fireSnapshot()}
          >
            {snapshotBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Save capture now
          </button>
        </div>
        <p className="system-confirm-dismiss-hint">Tap anywhere outside this box to cancel.</p>
      </div>
    </div>,
    document.body,
  );
}
