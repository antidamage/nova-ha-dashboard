"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { TrainingStatus } from "./types";
import { BUSY } from "./voice-training-model";

async function api(path: string, init?: RequestInit) {
  const response = await fetch(`/api/voice/training${path}`, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(detail || `request failed (${response.status})`);
  }
  return response.json();
}

// State, polling and actions for VoiceTrainingConfig (see the comment there).
export function useVoiceTraining() {
  const [status, setStatus] = useState<TrainingStatus | null>(null);
  const [error, setError] = useState("");
  const [newId, setNewId] = useState("");
  const [uploading, setUploading] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [publishing, setPublishing] = useState<string | null>(null);
  const fileInputs = useRef<Record<string, HTMLInputElement | null>>({});

  const [paused, setPaused] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setStatus(await api(""));
      setError("");
      setPaused(false);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      // The voice API is stopped while a run holds the GPU, and again briefly
      // while it restarts afterwards -- so "unreachable" is an EXPECTED state
      // here, not a fault. Showing a raw connection error at exactly the moment
      // training is working is alarming and wrong; report the pause instead and
      // keep polling until it answers again.
      if (/unreachable|ECONNREFUSED|refused|502|timed out/i.test(message)) {
        setPaused(true);
        setError("");
      } else {
        setError(message);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Poll while anything is running so progress advances without interaction, and
  // while the voice API is paused so the panel recovers on its own once it is
  // back. Idle otherwise, so an untouched config page isn't hitting the host.
  const busy = status?.sets.some((set) => BUSY.has(set.state.status)) ?? false;
  useEffect(() => {
    if (!busy && !paused) return;
    const timer = setInterval(() => void refresh(), 5000);
    return () => clearInterval(timer);
  }, [busy, paused, refresh]);

  const act = async (path: string, init?: RequestInit) => {
    try {
      await api(path, init);
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  };

  const createSet = async () => {
    const id = newId.trim();
    if (!id) return;
    await act("/sets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, name: id, language: "en" }),
    });
    setNewId("");
  };

  /**
   * Upload in batches. 100+ wav files in a single multipart body is a very large
   * request and gives no progress feedback; chunking keeps each request modest
   * and lets the count climb visibly as it goes.
   */
  const uploadFiles = async (setId: string, files: FileList | null) => {
    if (!files || files.length === 0) return;
    const all = Array.from(files);
    const BATCH = 25;
    setUploading(setId);
    setUploadProgress(0);
    try {
      for (let index = 0; index < all.length; index += BATCH) {
        const form = new FormData();
        for (const file of all.slice(index, index + BATCH)) form.append("files", file);
        await api(`/sets/${encodeURIComponent(setId)}/samples`, { method: "POST", body: form });
        setUploadProgress(Math.min(index + BATCH, all.length));
      }
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setUploading(null);
      setUploadProgress(0);
    }
  };

  const sets = status?.sets ?? [];
  return {
    status,
    error,
    newId,
    setNewId,
    uploading,
    uploadProgress,
    publishing,
    setPublishing,
    fileInputs,
    paused,
    act,
    createSet,
    uploadFiles,
    sets,
  };
}
