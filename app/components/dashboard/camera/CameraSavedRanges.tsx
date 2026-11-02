"use client";

import { Download, Film, Loader2, Play, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { SavedRangeSummary } from "../../../../lib/camera/saved-ranges-model";
import { ConfirmDialog } from "../../ConfirmDialog";
import type { CameraAdvancedModuleProps } from "./advanced-modules";
import { formatBytes, formatCreated, formatDuration } from "./format-model";
import { SavedRangePlayer } from "./SavedRangePlayer";
import { SavedRangeSelector } from "./SavedRangeSelector";
import { useSavedRanges } from "./useSavedRanges";

function rowDetail(range: SavedRangeSummary): string {
  if (range.state === "saving") return `Saving ${Math.round((range.progress ?? 0) * 100)}%`;
  if (range.state === "failed") return range.error ?? "The save failed.";
  return `${formatDuration(range.durationSeconds)} · ${formatBytes(range.sizeBytes)}`;
}

/** The Saved Ranges module: save a range of the DVR window, then list, play and download. */
export function CameraSavedRanges({ cameraId, oldestMs, newestMs }: CameraAdvancedModuleProps) {
  const { ranges, message, busy, save, remove, download } = useSavedRanges(cameraId);
  const [selecting, setSelecting] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<SavedRangeSummary | null>(null);
  const playingRange = ranges.find((range) => range.id === playingId && range.state === "ready") ?? null;
  const canSelect = Number.isFinite(oldestMs) && Number.isFinite(newestMs) && newestMs > oldestMs;

  return (
    <div className="advanced-fold-row saved-ranges">
      <div className="saved-ranges-header">
        <Film className="h-4 w-4" aria-hidden="true" />
        <span className="saved-ranges-title">Saved Ranges</span>
        {!selecting ? (
          <button type="button" className="saved-range-button" disabled={!canSelect} onClick={() => setSelecting(true)}>
            <Plus className="h-4 w-4" aria-hidden="true" />
            Save a range
          </button>
        ) : null}
      </div>

      {message ? <p className="saved-ranges-message">{message}</p> : null}

      {selecting ? (
        <SavedRangeSelector
          cameraId={cameraId}
          oldestMs={oldestMs}
          newestMs={newestMs}
          busy={busy}
          onCancel={() => setSelecting(false)}
          onSave={(startMs, endMs) => {
            void save(startMs, endMs).then((saved) => {
              if (saved) setSelecting(false);
            });
          }}
        />
      ) : null}

      {playingRange ? <SavedRangePlayer key={playingRange.id} cameraId={cameraId} range={playingRange} onClose={() => setPlayingId(null)} /> : null}

      {ranges.length === 0 ? (
        <p className="saved-ranges-empty">No saved ranges yet.</p>
      ) : (
        <ul className="saved-ranges-list">
          {ranges.map((range) => (
            <li key={range.id} className="saved-range-item">
              <div className="saved-range-meta">
                <span className="saved-range-when">{formatCreated(new Date(range.startMs).toISOString())}</span>
                <span className="saved-range-detail">
                  {range.state === "saving" ? <Loader2 className="saved-range-spinner h-3 w-3 animate-spin" aria-hidden="true" /> : null}
                  {rowDetail(range)}
                </span>
              </div>
              {range.state === "ready" ? (
                <>
                  <button type="button" className="saved-range-button" onClick={() => setPlayingId(range.id)}>
                    <Play className="h-4 w-4" aria-hidden="true" />
                    Play
                  </button>
                  <button type="button" className="saved-range-button" onClick={() => void download(range)}>
                    <Download className="h-4 w-4" aria-hidden="true" />
                    Download
                  </button>
                </>
              ) : null}
              {range.state !== "saving" ? (
                <button type="button" className="saved-range-button" aria-label="Delete" onClick={() => setDeleting(range)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleting !== null}
        busy={busy}
        copy={deleting ? { stages: [{ title: "Delete this range?", body: "Its saved video is removed for good.", confirmLabel: "Delete" }] } : null}
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          if (playingId === deleting.id) setPlayingId(null);
          void remove(deleting.id).then(() => setDeleting(null));
        }}
      />
    </div>
  );
}
