"use client";

// The two Sound blocks on the config page: which clip each of the thirteen UX
// actions plays, and the library of clips those assignments point at. See
// specs/ux-sounds.md.

import { Play, Trash2, Upload } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ConfigAccordion } from "./ConfigControls";
import { ConfigSelect } from "./ConfigSelect";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { previewSound } from "./dashboard/controlSound";
import {
  fetchSoundLibrary,
  SOUND_LIBRARY_CHANGED_EVENT,
} from "./dashboard/useSoundLibrary";
import {
  REMINDER_AUDIO_SOUND,
  UX_SOUND_ACTION_LABELS,
  UX_SOUND_ACTIONS,
  migrateLegacySoundId,
  type UxSoundAction,
  type UxSoundAssignments,
} from "./dashboard/uxSoundActions";
import { soundUrl, SOUND_FILE_MAX_BYTES, type SoundLibraryEntry } from "../../lib/sound-library";

/** The reminder MP3 is server-stored and uploaded under Reminders, not here. */
const REMINDER_AUDIO_URL = "/api/tasks/audio";

function announceLibraryChange() {
  window.dispatchEvent(new CustomEvent(SOUND_LIBRARY_CHANGED_EVENT));
}

/** Loads the library and keeps it current while the config page is open. */
function useLibraryEntries(): SoundLibraryEntry[] {
  const [entries, setEntries] = useState<SoundLibraryEntry[]>([]);

  useEffect(() => {
    const reload = () => {
      void fetchSoundLibrary().then(setEntries).catch(() => undefined);
    };
    reload();
    window.addEventListener(SOUND_LIBRARY_CHANGED_EVENT, reload);
    return () => window.removeEventListener(SOUND_LIBRARY_CHANGED_EVENT, reload);
  }, []);

  return entries;
}

/** Play button for one clip. Disabled when the row has nothing to play. */
function SoundPreviewButton({ label, url }: { label: string; url: string | null }) {
  return (
    <MomentaryFeedbackButton
      type="button"
      className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black disabled:border-neutral-700 disabled:text-neutral-600"
      aria-label={`Preview ${label}`}
      disabled={!url}
      /* The preview is the clip itself, not the generic click. */
      data-ux-sound="none"
      onClick={() => previewSound(url)}
    >
      <Play className="h-4 w-4" />
      Play
    </MomentaryFeedbackButton>
  );
}

export function SoundLibraryConfig() {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [entries, setEntries] = useState<SoundLibraryEntry[]>([]);
  const [message, setMessage] = useState<string | null>(null);

  const reload = () => {
    void fetchSoundLibrary()
      .then(setEntries)
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "Failed to read the library"));
  };

  useEffect(reload, []);

  const upload = async (file: File | null) => {
    if (!file) {
      return;
    }
    if (file.size > SOUND_FILE_MAX_BYTES) {
      setMessage(`File is too large (max ${Math.round(SOUND_FILE_MAX_BYTES / 1000)} KB)`);
      return;
    }

    setMessage(null);
    try {
      const form = new FormData();
      form.set("file", file);
      const response = await fetch("/api/sounds", { method: "POST", body: form });
      const body = (await response.json()) as { entries?: SoundLibraryEntry[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Upload failed");
      }
      setEntries(body.entries ?? []);
      announceLibraryChange();
      setMessage("Sound added");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Upload failed");
    } finally {
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const rename = async (id: string, name: string) => {
    try {
      const response = await fetch("/api/sounds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, name }),
      });
      const body = (await response.json()) as { entries?: SoundLibraryEntry[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Rename failed");
      }
      setEntries(body.entries ?? []);
      announceLibraryChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Rename failed");
    }
  };

  const remove = async (id: string) => {
    try {
      const response = await fetch(`/api/sounds?id=${encodeURIComponent(id)}`, { method: "DELETE" });
      const body = (await response.json()) as { entries?: SoundLibraryEntry[]; error?: string };
      if (!response.ok) {
        throw new Error(body.error ?? "Delete failed");
      }
      setEntries(body.entries ?? []);
      announceLibraryChange();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Delete failed");
    }
  };

  return (
    // Collapsed by default: the clips are a store to dip into when adding one,
    // while the assignments above are the part that gets tuned.
    <ConfigAccordion id="sound-library" title="Sound Library" className="config-sub-accordion">
      <div className="grid gap-3">
        {message ? <span className="font-mono text-xs uppercase text-cyan-100">{message}</span> : null}

        <div className="grid gap-2">
          {entries.map((entry) => (
            <div
              key={entry.id}
              className="grid gap-2 border border-neutral-700 p-2 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
            >
              {entry.origin === "builtin" ? (
                <span className="font-mono text-sm font-black uppercase text-neutral-300">{entry.name}</span>
              ) : (
                <input
                  className="min-h-11 border border-neutral-700 bg-neutral-950 px-3 font-mono text-sm font-black uppercase text-neutral-200"
                  defaultValue={entry.name}
                  aria-label={`Name for ${entry.name}`}
                  onBlur={(event) => {
                    const next = event.target.value.trim();
                    if (next && next !== entry.name) void rename(entry.id, next);
                  }}
                />
              )}
              <div className="flex flex-wrap justify-end gap-2">
                <SoundPreviewButton label={entry.name} url={soundUrl(entry)} />
                {entry.origin === "upload" ? (
                  <button
                    className="inline-flex min-h-11 items-center gap-2 border border-red-400/60 px-4 py-2 text-sm font-black"
                    type="button"
                    aria-label={`Delete ${entry.name}`}
                    onClick={() => void remove(entry.id)}
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={(event) => void upload(event.target.files?.[0] ?? null)}
          />
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
            type="button"
            onClick={() => inputRef.current?.click()}
          >
            <Upload className="h-4 w-4" />
            Upload
          </button>
        </div>
      </div>
    </ConfigAccordion>
  );
}

export function UxSoundAssignmentsConfig({
  value,
  onChange,
}: {
  value: UxSoundAssignments;
  onChange: (value: UxSoundAssignments) => void;
}) {
  const entries = useLibraryEntries();

  // None first, then the server-stored reminder clip, then the library
  // (specs/ux-sounds.md, "Config UI").
  const options = [
    { value: "", label: "None" },
    { value: REMINDER_AUDIO_SOUND, label: "Reminder audio (uploaded)" },
    ...entries.map((entry) => ({ value: entry.id, label: entry.name })),
  ];

  const urls = useMemo(() => {
    const byId = new Map(entries.map((entry) => [entry.id, soundUrl(entry)]));
    byId.set(REMINDER_AUDIO_SOUND, REMINDER_AUDIO_URL);
    return byId;
  }, [entries]);

  return (
    <div className="intensity-panel grid gap-3 border border-cyan-300/30 bg-neutral-900/80 p-4">
      <p className="text-sm font-black uppercase text-cyan-200">Sound Assignments</p>
      <div className="grid gap-2">
        {UX_SOUND_ACTIONS.map((action: UxSoundAction) => {
          const assigned = value[action] ?? "";
          const label = UX_SOUND_ACTION_LABELS[action];
          return (
            <div
              key={action}
              className="grid gap-2 md:grid-cols-[180px_minmax(0,1fr)_auto] md:items-center"
            >
              <span className="font-mono text-sm font-black uppercase text-neutral-300">{label}</span>
              <ConfigSelect
                ariaLabel={`${label} sound`}
                options={options}
                value={assigned}
                onChange={(next) => onChange({ ...value, [action]: next === "" ? null : next })}
              />
              <SoundPreviewButton
                label={label}
                url={assigned ? urls.get(migrateLegacySoundId(assigned)) ?? null : null}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
