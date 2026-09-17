"use client";

import { Camera } from "lucide-react";
import { ConfigAccordion } from "../../ConfigControls";
import { useAgentName } from "../../AgentNameContext";
import { CameraAnalysisConfig } from "./CameraAnalysisConfig";
import { DEMO_MODE, FALLBACK } from "./constants";
import { FeedStatusPanel } from "./FeedStatusPanel";
import { IngestionToggle } from "./IngestionToggle";
import { ReinitConfirmDialog } from "./ReinitConfirmDialog";
import { Setting } from "./Setting";
import { useCameraPreview } from "./useCameraPreview";
import { useCameraReinit } from "./useCameraReinit";
import { useCameraSettings } from "./useCameraSettings";
import { VideoHostField } from "./VideoHostField";

export function CameraConfig() {
  const { agentName } = useAgentName();
  const {
    ingestionBusy,
    ingestionEnabled,
    message,
    save,
    saved,
    saveVideoHost,
    setMessage,
    setValue,
    setVideoHostDraft,
    toggleIngestion,
    value,
    videoHostBusy,
    videoHostDraft,
    videoHostMessage,
    videoHostUrl,
  } = useCameraSettings();
  const { status, videoRef } = useCameraPreview({ saved, setMessage, videoHostUrl });
  const {
    closeConfirm,
    confirmStage,
    onConfirm,
    reinitBusy,
    reinitMessage,
    setConfirmStage,
  } = useCameraReinit(videoHostUrl);

  return (
    <ConfigAccordion id="camera" title="Camera" icon={<Camera className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div className="grid gap-3">
          <VideoHostField
            saveVideoHost={saveVideoHost}
            setVideoHostDraft={setVideoHostDraft}
            videoHostBusy={videoHostBusy}
            videoHostDraft={videoHostDraft}
            videoHostMessage={videoHostMessage}
            videoHostUrl={videoHostUrl}
          />

          <IngestionToggle
            ingestionBusy={ingestionBusy}
            ingestionEnabled={ingestionEnabled}
            toggleIngestion={toggleIngestion}
          />

          <Setting label="Brightness" min={-1} max={1} step={0.01} value={value.brightness} onChange={(brightness) => setValue({ ...value, brightness })} onCommit={(brightness) => void save({ ...value, brightness })} />
          <Setting label="Contrast" min={0} max={2} step={0.01} value={value.contrast} onChange={(contrast) => setValue({ ...value, contrast })} onCommit={(contrast) => void save({ ...value, contrast })} />
          <Setting label="Sharpness" min={0} max={5} step={0.1} value={value.sharpness} onChange={(sharpness) => setValue({ ...value, sharpness })} onCommit={(sharpness) => void save({ ...value, sharpness })} />
          <div className="flex items-center gap-3">
            <button type="button" className="config-page-button" onClick={() => { setValue(FALLBACK); void save(FALLBACK); }}>Reset</button>
            <span className="text-sm text-neutral-400">{message}</span>
          </div>

          <FeedStatusPanel
            reinitBusy={reinitBusy}
            reinitMessage={reinitMessage}
            setConfirmStage={setConfirmStage}
            status={status}
          />
        </div>
        <div>
          <video ref={videoRef} className="camera-config-preview" autoPlay muted playsInline />
        </div>
      </div>

      {!DEMO_MODE ? <CameraAnalysisConfig cameraId="outside" /> : null}

      <ReinitConfirmDialog
        agentName={agentName}
        closeConfirm={closeConfirm}
        confirmStage={confirmStage}
        onConfirm={onConfirm}
        reinitBusy={reinitBusy}
      />
    </ConfigAccordion>
  );
}
