"use client";

import { Trash2, UploadCloud } from "lucide-react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { useEngineVoices } from "./useEngineVoices";

// Engine-scoped voice catalogue: list the resident engine's registered
// voices, delete them, and upload new ones. What "upload" means depends on
// the engine's capabilities (from the server's engine registry, not a
// hardcoded id check): Custom (dots.tts) builds a reference.wav from raw
// sample clips server-side (CPU ffmpeg, no GPU training); Trained
// (GPT-SoVITS) stores an already fine-tuned checkpoint bundle produced by the
// voice-training scripts. Classic has no catalogue at all -- capabilities say
// so and the panel shows a short note instead of empty controls.
export function EngineVoicesPanel() {
  const {
    engineId,
    activeLabel,
    catalogueKind,
    voices,
    deleting,
    remove,
    id,
    setId,
    name,
    setName,
    language,
    setLanguage,
    speakerScale,
    setSpeakerScale,
    fileInputKey,
    setFiles,
    idValid,
    uploading,
    files,
    upload,
    message,
    messageTone,
  } = useEngineVoices();

  if (engineId === null) {
    return null;
  }

  return (
    <div className="mb-4 grid gap-3">
      <p className="text-xs font-black uppercase text-neutral-400">{activeLabel} voices</p>

      {catalogueKind === "none" ? (
        <p className="font-sans text-xs leading-snug text-neutral-500">
          The {activeLabel} engine has no voice catalogue to manage here — switch to Custom or
          Trained voices above to build or upload one.
        </p>
      ) : (
        <>
          {voices.length > 0 ? (
            <div className="grid gap-2">
              {voices.map((voice) => (
                <div
                  key={voice.id}
                  className="intensity-panel flex flex-wrap items-center justify-between gap-3 border border-cyan-300/30 bg-neutral-900/80 p-3"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-black uppercase text-cyan-200">
                      {voice.name || voice.id}
                    </p>
                    <p className="text-xs font-semibold text-cyan-200/80">
                      {voice.id} · {voice.language || "en"}
                      {typeof voice.speakerScale === "number" ? ` · scale ${voice.speakerScale}` : ""}
                    </p>
                  </div>
                  <MomentaryFeedbackButton
                    type="button"
                    className="config-page-button"
                    disabled={deleting !== null}
                    onClick={() => void remove(voice.id)}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden="true" />
                    Delete
                  </MomentaryFeedbackButton>
                </div>
              ))}
            </div>
          ) : (
            <p className="font-sans text-xs leading-snug text-neutral-500">
              No {activeLabel.toLowerCase()} registered yet.
            </p>
          )}

          <div className="intensity-panel grid gap-2 border border-cyan-300/30 bg-neutral-900/80 p-3">
            <p className="text-xs font-black uppercase text-neutral-400">
              {catalogueKind === "bundle" ? "Upload a trained voice" : "Build a voice"}
            </p>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                <span>Voice id</span>
                <input
                  className="cyber-text-input"
                  value={id}
                  onChange={(event) => setId(event.target.value)}
                  placeholder="johnny"
                />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                <span>Display name</span>
                <input
                  className="cyber-text-input"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Johnny Silverhand"
                />
              </label>
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                <span>Language</span>
                <input
                  className="cyber-text-input"
                  value={language}
                  onChange={(event) => setLanguage(event.target.value)}
                  placeholder="en"
                />
              </label>
              {catalogueKind === "clips" ? (
                <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                  <span>Speaker scale</span>
                  <input
                    type="number"
                    min={0.1}
                    max={5}
                    step={0.1}
                    className="cyber-text-input"
                    value={speakerScale}
                    onChange={(event) => setSpeakerScale(Number(event.target.value) || 1.5)}
                  />
                </label>
              ) : null}
            </div>
            <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
              <span>{catalogueKind === "bundle" ? "Voice bundle files" : "Sample clips"}</span>
              <input
                key={fileInputKey}
                type="file"
                accept={catalogueKind === "clips" ? "audio/*" : undefined}
                multiple
                className="cyber-text-input"
                onChange={(event) => setFiles(Array.from(event.target.files ?? []))}
              />
            </label>
            {id && !idValid ? (
              <p className="text-xs font-semibold text-red-200">
                Voice id must be lowercase letters, digits, - or _ (1-64 chars).
              </p>
            ) : null}
            <MomentaryFeedbackButton
              type="button"
              className="config-page-button"
              disabled={uploading || !idValid || files.length === 0}
              onClick={() => void upload()}
            >
              <UploadCloud className={`h-4 w-4 ${uploading ? "animate-pulse" : ""}`} aria-hidden="true" />
              {uploading ? "Uploading…" : catalogueKind === "bundle" ? "Upload voice" : "Build & upload"}
            </MomentaryFeedbackButton>
          </div>
        </>
      )}

      {message ? (
        <p
          role="status"
          className={`text-xs font-semibold ${
            messageTone === "ok"
              ? "text-cyan-200"
              : messageTone === "warning"
                ? "text-yellow-200"
                : "text-red-200"
          }`}
        >
          {message}
        </p>
      ) : null}
      {catalogueKind === "clips" ? (
        <p className="font-sans text-xs leading-snug text-neutral-500">
          Upload one or more clean sample clips (or a reference.wav already prepared with the
          voice-training scripts) under a lowercase id. The server trims silence, concatenates, and
          loudness-normalizes them into one reference clip dots.tts clones from -- no GPU training
          involved. Deleting a voice removes it immediately and cannot be undone.
        </p>
      ) : catalogueKind === "bundle" ? (
        <p className="font-sans text-xs leading-snug text-neutral-500">
          Upload the checkpoint bundle produced by the voice-training scripts (train on a GPU
          machine first) under a lowercase id. The server stores it as-is -- no training happens
          here. Deleting a voice removes it immediately and cannot be undone.
        </p>
      ) : null}
    </div>
  );
}
