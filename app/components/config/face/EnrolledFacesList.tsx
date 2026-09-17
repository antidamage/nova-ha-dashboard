"use client";

import { Trash2 } from "lucide-react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { FaceSubject } from "./types";

/**
 * The enrolled faces, each with its clip count and a remove button that opens
 * the confirm dialog. Split out of `FaceEnrolmentConfig.tsx`
 * (specs/agent-token-footprint.md §4).
 */
export function EnrolledFacesList({
  setPendingDelete,
  subjects,
}: {
  setPendingDelete: (subject: FaceSubject) => void;
  subjects: FaceSubject[];
}) {
  return (
    <section className="grid gap-1.5" aria-labelledby="enrolled-faces-heading">
      <p id="enrolled-faces-heading" className="text-xs font-bold uppercase text-neutral-400">
        Enrolled faces ({subjects.length})
      </p>
      {subjects.map((subject) => (
        <div
          key={subject.id}
          className="flex items-center gap-3 border border-neutral-800 bg-black/20 px-3 py-2 text-xs"
        >
          {/* No face image is shown because none is stored. This used to be
              an <img> of a 256px crop; the crop is gone, so the row is a
              name and a clip count. Adeline, 2026-09-03: "I don't want to
              store the video and thumbnail at all for a user." */}
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold text-neutral-200">{subject.name}</p>
            <p className="text-neutral-500">
              {subject.clips} clip{subject.clips === 1 ? "" : "s"}
              <span className={subject.ready ? "ml-2 text-emerald-300" : "ml-2 text-amber-300"}>
                {subject.ready ? "ready" : "not enough clips"}
              </span>
            </p>
          </div>
          <MomentaryFeedbackButton
            type="button"
            className="config-page-button"
            aria-label={`Remove ${subject.name}`}
            onClick={() => setPendingDelete(subject)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden="true" /> Remove
          </MomentaryFeedbackButton>
        </div>
      ))}
      {!subjects.length ? <p className="text-sm text-neutral-500">Nobody is enrolled yet.</p> : null}
    </section>
  );
}
