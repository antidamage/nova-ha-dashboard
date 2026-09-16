"use client";

import { Trash2 } from "lucide-react";
import type { SpeakerProfileSummary, SpeakerTemplateSummary } from "../../../../lib/voice-host-settings";
import { relativeLastSeen, timeToExpiry } from "./speaker-profiles-model";

export function RecordedIdentityRow({
  template,
  profile,
  nowMs,
  onDelete,
  profiles = [],
  onAssign,
  deleting,
}: {
  template: SpeakerTemplateSummary;
  profile?: SpeakerProfileSummary;
  nowMs: number | null;
  onDelete: (id: string) => Promise<void>;
  profiles?: SpeakerProfileSummary[];
  onAssign?: (templateId: string, personId: string) => Promise<void>;
  deleting?: boolean;
}) {
  const identityLabel = profile?.displayName
    ?? (template.claimedName ? `Unassociated — claims ${template.claimedName}` : "Unassociated voice");
  return (
    <div className="grid gap-2 border border-neutral-800 bg-black/20 px-3 py-2.5 text-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <p className="truncate font-semibold text-neutral-200">{identityLabel}</p>
        <p className="mt-0.5 text-neutral-500">
          <span className="font-bold uppercase text-neutral-400">{template.state}</span>
          <span className="ml-2">{template.sampleCount} sample{template.sampleCount === 1 ? "" : "s"}</span>
          <span className="ml-2 font-mono text-neutral-600">{template.id.slice(0, 8)}</span>
        </p>
        <p className="mt-1 text-neutral-400">{relativeLastSeen(template.lastSeenAt, nowMs)}</p>
        <p className={template.expiresAt ? "text-amber-300/80" : "text-neutral-500"}>
          {timeToExpiry(template.expiresAt, nowMs)}
        </p>
      </div>
      <div className="flex items-center gap-2 sm:justify-self-end">
      {onAssign && profiles.length ? (
        <select
          aria-label="Assign voice template to person"
          className="border border-neutral-700 bg-neutral-950 px-1.5 py-1 text-neutral-300"
          value={profile?.id ?? ""}
          onChange={(event) => {
            if (event.target.value) void onAssign(template.id, event.target.value);
          }}
        >
          <option value="" disabled>Assign to…</option>
          {profiles.map((profile) => (
            <option key={profile.id} value={profile.id}>{profile.displayName}</option>
          ))}
        </select>
      ) : null}
      <button
        type="button"
        disabled={deleting}
        className="rounded border border-red-900/70 px-2 py-1 text-red-300 hover:bg-red-950/50 disabled:opacity-50"
        aria-label={`Delete recorded identity ${identityLabel}`}
        onClick={() => void onDelete(template.id)}
      >
        <Trash2 className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" /> Delete
      </button>
      </div>
    </div>
  );
}
