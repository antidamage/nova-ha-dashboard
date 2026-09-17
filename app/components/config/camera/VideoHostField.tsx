"use client";

import { Loader2 } from "lucide-react";
import { DEMO_MODE } from "./constants";

// Where the Outside stream is embedded FROM. Presentation only — the parent
// owns the draft, the busy flag and the save.
export function VideoHostField({
  saveVideoHost,
  setVideoHostDraft,
  videoHostBusy,
  videoHostDraft,
  videoHostMessage,
  videoHostUrl,
}: {
  saveVideoHost: () => void;
  setVideoHostDraft: (value: string) => void;
  videoHostBusy: boolean;
  videoHostDraft: string;
  videoHostMessage: string | null;
  videoHostUrl: string;
}) {
  return (
    <div className="grid gap-2 border border-cyan-300/20 bg-neutral-900/70 p-3">
      <span className="text-sm font-black uppercase text-cyan-200">Video host URL</span>
      <div className="flex items-center gap-2">
        <input
          type="text"
          inputMode="url"
          spellCheck={false}
          autoComplete="off"
          placeholder="http://camera-host.local:8080"
          value={videoHostDraft}
          disabled={DEMO_MODE || videoHostBusy}
          onChange={(event) => setVideoHostDraft(event.target.value)}
          onBlur={() => {
            if (videoHostDraft.trim() !== videoHostUrl.trim()) void saveVideoHost();
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
          }}
          className="min-w-0 flex-1 border border-cyan-300/30 bg-neutral-950/80 px-2 py-1.5 font-mono text-sm text-neutral-100 outline-none focus:border-cyan-300/70"
        />
        {videoHostBusy ? <Loader2 className="h-4 w-4 animate-spin text-cyan-200" aria-label="Saving video host" /> : null}
      </div>
      <span className="text-xs text-neutral-400">
        {videoHostMessage ??
          "Where the Outside camera stream originates (e.g. http://camera-host.local:8080). Nova relays it over this dashboard's secure origin. Leave blank to use this host's recorder."}
      </span>
    </div>
  );
}
