"use client";

import { AlertTriangle, CircleStop, GraduationCap, Play, Trash2, Upload } from "lucide-react";
import { ConfigAccordion } from "../../ConfigControls";
import { useVoiceTraining } from "./useVoiceTraining";
import { BUSY, statusLabel, statusTone } from "./voice-training-model";

/**
 * Voice Training: upload a speaker's samples, fine-tune a voice from them, and
 * publish the result as a selectable Trained voice.
 *
 * Training takes the GPU, so the voice assistant is stopped for the duration and
 * restored afterwards — that's surfaced prominently rather than buried, because
 * it means the household has no voice while a run is going.
 */
export function VoiceTrainingConfig() {
  const {
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
  } = useVoiceTraining();


  return (
    <ConfigAccordion
      id="voice-training"
      title="Voice Training"
      icon={<GraduationCap className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />

      <p className="mb-4 text-sm leading-relaxed text-neutral-400">
        Fine-tune a voice from your own recordings. Upload a speaker&apos;s samples (aim for 30–60
        minutes of clean speech), train, then publish the result as a Trained voice. You can stop a
        run at any point and still get a usable voice, then resume it later.
      </p>

      {status && !status.installed ? (
        <p className="mb-4 border border-amber-500/50 bg-amber-500/10 p-3 text-sm text-amber-200">
          GPT-SoVITS is not installed on the voice host. Training is unavailable until it is
          provisioned.
        </p>
      ) : null}

      {status?.trainingMode ? (
        <p className="mb-4 flex items-start gap-2 border border-cyan-500/50 bg-cyan-500/10 p-3 text-sm text-cyan-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong>Training mode is active.</strong> The assistant&apos;s speech models are stopped
            so training can use the GPU — voice responses are paused until the run finishes or is
            stopped, then the previous configuration is restored automatically.
          </span>
        </p>
      ) : null}

      {paused ? (
        <p className="mb-4 flex items-start gap-2 border border-cyan-500/50 bg-cyan-500/10 p-3 text-sm text-cyan-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>
            <strong>Voice server paused.</strong> Its speech models are stopped while training uses
            the GPU, and it takes a minute to warm up again afterwards. Training is unaffected — this
            panel will reconnect on its own.
          </span>
        </p>
      ) : null}

      {error ? (
        <p className="mb-4 border border-rose-500/50 bg-rose-500/10 p-3 text-sm text-rose-200">{error}</p>
      ) : null}

      <div className="mb-5 flex flex-wrap items-center gap-2">
        <input
          className="min-w-0 flex-1 border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm text-neutral-100"
          placeholder="New voice id (e.g. johnny)"
          value={newId}
          onChange={(event) => setNewId(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void createSet();
          }}
        />
        <button type="button" className="theme-library-button" onClick={() => void createSet()} disabled={!newId.trim()}>
          Create training set
        </button>
      </div>

      {sets.length === 0 ? (
        <p className="text-sm text-neutral-500">No training sets yet. Create one to get started.</p>
      ) : null}

      <div className="grid gap-4">
        {sets.map((set) => {
          const isBusy = BUSY.has(set.state.status);
          const isUploading = uploading === set.id;
          return (
            <div key={set.id} className="border border-neutral-700 bg-neutral-900/60 p-4">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                <span className="zone-title-bar text-base font-black uppercase text-cyan-200">{set.name}</span>
                <span className={`text-xs font-black uppercase ${statusTone(set.state)}`}>{statusLabel(set)}</span>
              </div>

              <p className="mb-3 text-xs text-neutral-400">
                {set.sampleCount} sample{set.sampleCount === 1 ? "" : "s"}
                {set.samplesChanged
                  ? " · new samples added, so the next run rebuilds and retrains from scratch"
                  : set.resumable
                    ? " · has checkpoints (training will continue)"
                    : ""}
                {set.state.totalEpochs > 0 && isBusy ? ` · epoch ${set.state.epoch}/${set.state.totalEpochs}` : ""}
              </p>

              {set.state.message ? (
                <p className="mb-3 text-xs text-neutral-300">{set.state.message}</p>
              ) : null}
              {set.state.error ? (
                <p className="mb-3 break-words text-xs text-rose-300">{set.state.error}</p>
              ) : null}
              {isUploading ? (
                <p className="mb-3 text-xs text-cyan-300">Uploading… {uploadProgress} file(s)</p>
              ) : null}

              <div className="flex flex-wrap gap-2">
                <input
                  ref={(element) => {
                    fileInputs.current[set.id] = element;
                  }}
                  type="file"
                  multiple
                  accept=".wav,.flac,.mp3,.m4a,.aac,.ogg,.opus,audio/*"
                  className="hidden"
                  onChange={(event) => {
                    void uploadFiles(set.id, event.target.files);
                    event.target.value = "";
                  }}
                />
                <button
                  type="button"
                  className="theme-library-button"
                  disabled={isBusy || isUploading}
                  onClick={() => fileInputs.current[set.id]?.click()}
                >
                  <Upload className="h-4 w-4" aria-hidden="true" /> Add samples
                </button>

                {isBusy ? (
                  <button
                    type="button"
                    className="theme-library-button"
                    disabled={set.state.status === "stopping"}
                    onClick={() => void act(`/sets/${encodeURIComponent(set.id)}/stop`, { method: "POST" })}
                  >
                    <CircleStop className="h-4 w-4" aria-hidden="true" />
                    {set.state.status === "stopping" ? "Stopping…" : "Stop & keep result"}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="theme-library-button"
                    disabled={set.sampleCount === 0 || !status?.installed}
                    onClick={() => void act(`/sets/${encodeURIComponent(set.id)}/start`, { method: "POST" })}
                  >
                    <Play className="h-4 w-4" aria-hidden="true" />
                    {set.samplesChanged ? "Retrain from scratch" : set.resumable ? "Resume training" : "Start training"}
                  </button>
                )}

                {set.state.hasBundle ? (
                  <button
                    type="button"
                    className="theme-library-button"
                    disabled={publishing === set.id}
                    onClick={async () => {
                      setPublishing(set.id);
                      try {
                        await act(`/sets/${encodeURIComponent(set.id)}/publish`, { method: "POST" });
                      } finally {
                        setPublishing(null);
                      }
                    }}
                  >
                    {publishing === set.id ? "Publishing…" : "Publish as voice"}
                  </button>
                ) : null}

                <button
                  type="button"
                  className="theme-library-button"
                  disabled={isBusy}
                  onClick={() => void act(`/sets/${encodeURIComponent(set.id)}`, { method: "DELETE" })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden="true" /> Delete
                </button>
              </div>

              {set.state.hasBundle && !set.state.complete ? (
                <p className="mt-3 text-xs text-amber-300">
                  This bundle came from a stopped run. It is usable for testing — publish it, switch
                  to the Trained engine and listen — and resuming will continue from where it left
                  off rather than starting over.
                </p>
              ) : null}
            </div>
          );
        })}
      </div>
    </ConfigAccordion>
  );
}
