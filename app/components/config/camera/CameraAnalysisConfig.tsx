"use client";

import { Bell, BellOff, Loader2, Moon, MousePointer2, RotateCcw, Save, SunMedium, Trash2, Undo2 } from "lucide-react";
import { useState } from "react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { AnalysisStage } from "./AnalysisStage";
import { COLORS } from "./constants";
import { ReferenceGallery } from "./ReferenceGallery";
import { useAnalysisReferences } from "./useAnalysisReferences";
import { useSceneZones } from "./useSceneZones";

export function CameraAnalysisConfig({ cameraId }: { cameraId: string }) {
  const [message, setMessage] = useState("Loading analysis zones…");
  const [saving, setSaving] = useState(false);
  const [frameVersion, setFrameVersion] = useState(Date.now());
  const [frameMode, setFrameMode] = useState<"daylight" | "live">("daylight");
  const {
    addPoint,
    dragPoint,
    finishDrag,
    historyDepth,
    replaceZone,
    save,
    selected,
    selectedId,
    setSelectedId,
    setSettings,
    settings,
    stageRef,
    undoLastChange,
  } = useSceneZones({ cameraId, setMessage, setSaving });
  const {
    deleteReference,
    referenceFile,
    referenceKind,
    referenceName,
    references,
    setReferenceFile,
    setReferenceKind,
    setReferenceName,
    uploadReference,
  } = useAnalysisReferences({ cameraId, setMessage, setSaving });

  if (!settings) {
    return <div className="camera-analysis-config"><p className="camera-event-empty"><Loader2 className="h-4 w-4 animate-spin" /> {message}</p></div>;
  }

  return (
    <section className="camera-analysis-config" aria-labelledby="camera-analysis-heading">
      <header className="camera-analysis-header">
        <div><p className="camera-events-kicker">Daytime machine vision</p><h3 id="camera-analysis-heading">Activity zones</h3></div>
        <div className="camera-analysis-actions">
          <MomentaryFeedbackButton type="button" className="config-page-button" onClick={() => { const next = { ...settings, enabled: !settings.enabled }; setSettings(next); void save(next); }}>
            <MousePointer2 className="h-4 w-4" /> Analysis {settings.enabled ? "on" : "off"}
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="config-page-button" onClick={() => { const next = { ...settings, alertsEnabled: !settings.alertsEnabled }; setSettings(next); void save(next); }}>
            {settings.alertsEnabled ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />} Alerts {settings.alertsEnabled ? "on" : "off"}
          </MomentaryFeedbackButton>
        </div>
      </header>
      <div className="camera-analysis-zone-tabs">
        {settings.zones.map((zone) => (
          <button key={zone.id} type="button" className={selectedId === zone.id ? "is-active" : ""} style={{ "--zone-color": COLORS[zone.kind] } as React.CSSProperties} onClick={() => setSelectedId(zone.id)}>{zone.label}</button>
        ))}
      </div>
      <AnalysisStage
        addPoint={addPoint}
        cameraId={cameraId}
        dragPoint={dragPoint}
        finishDrag={finishDrag}
        frameMode={frameMode}
        frameVersion={frameVersion}
        selectedId={selectedId}
        settings={settings}
        stageRef={stageRef}
      />
      <div className="camera-analysis-footer">
        <div className="camera-analysis-actions">
          <MomentaryFeedbackButton type="button" className="config-page-button" disabled={historyDepth === 0} onClick={undoLastChange}><Undo2 className="h-4 w-4" /> Undo change</MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="config-page-button" disabled={!selected?.points.length} onClick={() => selected && replaceZone({ ...selected, points: [] })}><Trash2 className="h-4 w-4" /> Redraw polygon</MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="config-page-button" onClick={() => { setFrameMode((value) => value === "daylight" ? "live" : "daylight"); setFrameVersion(Date.now()); }}>
            {frameMode === "daylight" ? <SunMedium className="h-4 w-4" /> : <Moon className="h-4 w-4" />} {frameMode === "daylight" ? "Daytime frame" : "Live frame"}
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="config-page-button" onClick={() => setFrameVersion(Date.now())}><RotateCcw className="h-4 w-4" /> Refresh frame</MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="config-page-button" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save zones</MomentaryFeedbackButton>
        </div>
        <span className="text-xs text-neutral-400">{message}</span>
      </div>
      <ReferenceGallery
        cameraId={cameraId}
        deleteReference={deleteReference}
        referenceFile={referenceFile}
        referenceKind={referenceKind}
        referenceName={referenceName}
        references={references}
        saving={saving}
        setReferenceFile={setReferenceFile}
        setReferenceKind={setReferenceKind}
        setReferenceName={setReferenceName}
        uploadReference={uploadReference}
      />
    </section>
  );
}
