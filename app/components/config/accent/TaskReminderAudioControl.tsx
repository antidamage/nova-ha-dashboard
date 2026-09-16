"use client";

import { Music, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  loadTaskReminderAudioStatus,
  removeTaskReminderAudio,
  uploadTaskReminderAudio,
  type TaskReminderAudioStatus,
} from "../../tasks/task-audio-client";
import { formatBytes } from "./accent-config-model";

export function TaskReminderAudioControl({ onStatusChange }: { onStatusChange?: (exists: boolean) => void }) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<TaskReminderAudioStatus | null>(null);

  const loadStatus = useCallback(async () => {
    try {
      const nextStatus = await loadTaskReminderAudioStatus();
      setStatus(nextStatus);
      onStatusChange?.(nextStatus.exists);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read reminder audio");
    }
  }, [onStatusChange]);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const uploadFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await uploadTaskReminderAudio(file);
      setStatus(nextStatus);
      onStatusChange?.(nextStatus.exists);
      setMessage("Reminder audio uploaded");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload reminder audio");
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const removeFile = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await removeTaskReminderAudio();
      setStatus(nextStatus);
      onStatusChange?.(nextStatus.exists);
      setMessage("Reminder audio removed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove reminder audio");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
      <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center">
        <p className="text-sm font-black uppercase text-cyan-200">Reminder MP3</p>
        <div className="grid gap-1 font-mono text-sm font-black uppercase text-neutral-300">
          <span className="inline-flex items-center gap-2">
            <Music className="h-4 w-4" />
            {status?.exists ? "Audio ready" : "No MP3 uploaded"}
          </span>
          {status?.exists ? (
            <span className="text-xs text-neutral-500">
              {formatBytes(status.size)}
              {status.updatedAt ? ` / ${new Date(status.updatedAt).toLocaleString()}` : ""}
            </span>
          ) : null}
          {message ? <span className="text-xs text-cyan-100">{message}</span> : null}
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <input
            ref={inputRef}
            className="sr-only"
            type="file"
            accept="audio/mpeg,.mp3"
            onChange={(event) => void uploadFile(event.target.files?.[0] ?? null)}
          />
          <button
            className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
            type="button"
            onClick={() => inputRef.current?.click()}
            disabled={busy}
          >
            <Upload className="h-4 w-4" />
            {busy ? "Working" : "Upload"}
          </button>
          {status?.exists ? (
            <button
              className="inline-flex min-h-11 items-center gap-2 border border-red-400/60 px-4 py-2 text-sm font-black"
              type="button"
              onClick={() => void removeFile()}
              disabled={busy}
            >
              <Trash2 className="h-4 w-4" />
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
