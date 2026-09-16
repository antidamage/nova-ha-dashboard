"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CUSTOM_SPEAKER_PATTERN,
  VOICE_ENGINE_CAPABILITIES,
  type VoiceEngine,
  type VoiceEngineDescriptor,
} from "../../../../lib/voice-settings";
import type { EngineVoiceRow } from "./types";

// State and actions for EngineVoicesPanel (see the comment there).
export function useEngineVoices() {
  const [engineId, setEngineId] = useState<string | null>(null);
  const [engines, setEngines] = useState<VoiceEngineDescriptor[]>([]);
  const [voices, setVoices] = useState<EngineVoiceRow[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [messageTone, setMessageTone] = useState<"ok" | "warning" | "error">("ok");

  const [id, setId] = useState("");
  const [name, setName] = useState("");
  const [language, setLanguage] = useState("en");
  const [speakerScale, setSpeakerScale] = useState(1.5);
  const [files, setFiles] = useState<File[]>([]);
  const [fileInputKey, setFileInputKey] = useState(0);

  const loadEngine = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/engine", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as {
        engine?: string;
        engines?: VoiceEngineDescriptor[];
      };
      setEngineId(typeof data.engine === "string" && data.engine ? data.engine : null);
      setEngines(Array.isArray(data.engines) ? data.engines : []);
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice engine status", error);
    }
  }, []);

  const activeEngine = engines.find((entry) => entry.id === engineId) ?? null;
  const capabilities = activeEngine?.capabilities
    ?? (engineId && engineId in VOICE_ENGINE_CAPABILITIES
      ? VOICE_ENGINE_CAPABILITIES[engineId as VoiceEngine]
      : null);
  const catalogueKind = capabilities?.voiceCatalogue ?? "none";
  const activeLabel = activeEngine?.label ?? engineId ?? "voice engine";

  const loadVoices = useCallback(async () => {
    if (!engineId || catalogueKind === "none") {
      setVoices([]);
      return;
    }
    try {
      const response = await fetch(`/api/voice/voices/${encodeURIComponent(engineId)}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as { voices?: EngineVoiceRow[] };
      setVoices(Array.isArray(data.voices) ? data.voices : []);
    } catch (error) {
      console.error(`[nova-dashboard] failed to load ${engineId} voices`, error);
    }
  }, [engineId, catalogueKind]);

  useEffect(() => {
    void loadEngine();
    const timer = window.setInterval(() => void loadEngine(), 30_000);
    return () => window.clearInterval(timer);
  }, [loadEngine]);

  useEffect(() => {
    void loadVoices();
  }, [loadVoices]);

  // The upload id names a new catalogue entry regardless of engine -- same
  // slug shape the server's voice registries normalize to either way.
  const idValid = CUSTOM_SPEAKER_PATTERN.test(id);

  const upload = useCallback(async () => {
    if (!engineId || catalogueKind === "none") {
      return;
    }
    if (!idValid) {
      setMessage("Voice id must be lowercase letters, digits, - or _ (1-64 chars).");
      setMessageTone("error");
      return;
    }
    if (files.length === 0) {
      setMessage(catalogueKind === "bundle" ? "Choose the trained voice bundle files." : "Choose at least one sample clip.");
      setMessageTone("error");
      return;
    }
    setUploading(true);
    setMessage(
      catalogueKind === "bundle"
        ? `Uploading "${name || id}"…`
        : `Building "${name || id}" from ${files.length} clip${files.length === 1 ? "" : "s"}…`,
    );
    setMessageTone("ok");
    try {
      const formData = new FormData();
      formData.set("id", id);
      formData.set("name", name.trim() || id);
      formData.set("language", language.trim() || "en");
      if (catalogueKind === "clips") {
        formData.set("speaker_scale", String(speakerScale));
      }
      for (const file of files) {
        formData.append("files", file);
      }
      const response = await fetch(`/api/voice/voices/${encodeURIComponent(engineId)}`, {
        method: "POST",
        body: formData,
      });
      const data = await response.json() as { error?: string; voice?: { reference_seconds?: number } };
      if (!response.ok) {
        throw new Error(data.error || `Upload failed: ${response.status}`);
      }
      const seconds = data.voice?.reference_seconds;
      setMessage(`"${name || id}" is ready${seconds ? ` — ${seconds}s reference built` : ""}.`);
      setMessageTone("ok");
      setFiles([]);
      setFileInputKey((key) => key + 1);
      void loadVoices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload voice");
      setMessageTone("error");
    } finally {
      setUploading(false);
    }
  }, [engineId, catalogueKind, id, idValid, files, name, language, speakerScale, loadVoices]);

  const remove = useCallback(async (voiceId: string) => {
    if (!engineId) {
      return;
    }
    setDeleting(voiceId);
    setMessage(`Deleting "${voiceId}"…`);
    setMessageTone("ok");
    try {
      const response = await fetch(
        `/api/voice/voices/${encodeURIComponent(engineId)}/${encodeURIComponent(voiceId)}`,
        { method: "DELETE" },
      );
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Delete failed: ${response.status}`);
      }
      setMessage(`"${voiceId}" deleted.`);
      setMessageTone("warning");
      void loadVoices();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to delete voice");
      setMessageTone("error");
    } finally {
      setDeleting(null);
    }
  }, [engineId, loadVoices]);

  return {
    engineId,
    voices,
    deleting,
    uploading,
    message,
    messageTone,
    id,
    setId,
    name,
    setName,
    language,
    setLanguage,
    speakerScale,
    setSpeakerScale,
    files,
    setFiles,
    fileInputKey,
    catalogueKind,
    activeLabel,
    idValid,
    upload,
    remove,
  };
}
