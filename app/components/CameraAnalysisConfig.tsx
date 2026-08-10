"use client";

import { Bell, BellOff, ImagePlus, Loader2, MousePointer2, RotateCcw, Save, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";

type Point = [number, number];
type SceneZone = { id: string; label: string; kind: "activity" | "vehicle" | "exclude"; points: Point[] };
type AnalysisSettings = { enabled: boolean; alertsEnabled: boolean; zones: SceneZone[] };
type ReferenceImage = { id: string; kind: "cat" | "ute"; name: string; created_at: string };

const COLORS: Record<SceneZone["kind"], string> = { activity: "#54f5d0", vehicle: "#ffd56b", exclude: "#ff6b80" };

export function CameraAnalysisConfig({ cameraId }: { cameraId: string }) {
  const [settings, setSettings] = useState<AnalysisSettings | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading analysis zones…");
  const [saving, setSaving] = useState(false);
  const [frameVersion, setFrameVersion] = useState(Date.now());
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [referenceKind, setReferenceKind] = useState<"cat" | "ute">("cat");
  const [referenceName, setReferenceName] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/camera/${cameraId}/analysis`, { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("Camera analysis service is unavailable");
        return response.json() as Promise<AnalysisSettings>;
      })
      .then((value) => {
        if (!alive) return;
        setSettings(value);
        setSelectedId(value.zones[0]?.id ?? null);
        setMessage("Click the image to add points to the selected polygon.");
      })
      .catch((error) => alive && setMessage(error instanceof Error ? error.message : "Could not load analysis zones"));
    return () => { alive = false; };
  }, [cameraId]);

  const loadReferences = useCallback(async () => {
    const response = await fetch(`/api/camera/${cameraId}/analysis/references`, { cache: "no-store" });
    if (response.ok) setReferences(((await response.json()) as { references: ReferenceImage[] }).references);
  }, [cameraId]);

  useEffect(() => { void loadReferences(); }, [loadReferences]);

  const selected = useMemo(() => settings?.zones.find((zone) => zone.id === selectedId) ?? null, [selectedId, settings]);

  const replaceZone = useCallback((zone: SceneZone) => {
    setSettings((current) => current ? { ...current, zones: current.zones.map((item) => item.id === zone.id ? zone : item) } : current);
  }, []);

  const addPoint = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!selected || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const point: Point = [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    ];
    replaceZone({ ...selected, points: [...selected.points, point] });
  }, [replaceZone, selected]);

  const save = useCallback(async (next = settings) => {
    if (!next) return;
    if (next.zones.some((zone) => zone.points.length < 3)) {
      setMessage("Every zone needs at least three points before it can be saved.");
      return;
    }
    setSaving(true);
    try {
      const response = await fetch(`/api/camera/${cameraId}/analysis`, {
        method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("Could not save analysis settings");
      setSettings((await response.json()) as AnalysisSettings);
      setMessage("Analysis settings saved.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save analysis settings");
    } finally {
      setSaving(false);
    }
  }, [cameraId, settings]);

  const uploadReference = useCallback(async () => {
    if (!referenceFile || !referenceName.trim()) {
      setMessage("Choose an image and enter the cat or ute name first.");
      return;
    }
    const body = new FormData();
    body.set("kind", referenceKind);
    body.set("name", referenceName.trim());
    body.set("image", referenceFile);
    setSaving(true);
    try {
      const response = await fetch(`/api/camera/${cameraId}/analysis/references`, { method: "POST", body });
      if (!response.ok) throw new Error("Could not save that reference image");
      setReferenceFile(null);
      setReferenceName("");
      await loadReferences();
      setMessage("Reference image saved for detailed matching.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save that reference image");
    } finally {
      setSaving(false);
    }
  }, [cameraId, loadReferences, referenceFile, referenceKind, referenceName]);

  const deleteReference = useCallback(async (referenceId: string) => {
    const response = await fetch(`/api/camera/${cameraId}/analysis/references/${referenceId}`, { method: "DELETE" });
    if (response.ok) await loadReferences();
  }, [cameraId, loadReferences]);

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
      <div ref={stageRef} className="camera-analysis-stage" onPointerDown={addPoint}>
        <img src={`/api/camera/${cameraId}/analysis/frame?v=${frameVersion}`} alt="Current Outside camera frame for zone calibration" draggable={false} />
        <svg viewBox="0 0 1000 562.5" preserveAspectRatio="none" aria-hidden="true">
          {settings.zones.map((zone) => (
            <g key={zone.id} opacity={selectedId === zone.id ? 1 : 0.45}>
              <polygon points={zone.points.map(([x, y]) => `${x * 1000},${y * 562.5}`).join(" ")} fill={`${COLORS[zone.kind]}26`} stroke={COLORS[zone.kind]} strokeWidth={selectedId === zone.id ? 4 : 2} vectorEffect="non-scaling-stroke" />
              {selectedId === zone.id ? zone.points.map(([x, y], index) => <circle key={index} cx={x * 1000} cy={y * 562.5} r="7" fill={COLORS[zone.kind]} vectorEffect="non-scaling-stroke" />) : null}
            </g>
          ))}
        </svg>
      </div>
      <div className="camera-analysis-footer">
        <div className="camera-analysis-actions">
          <MomentaryFeedbackButton type="button" className="config-page-button" disabled={!selected?.points.length} onClick={() => selected && replaceZone({ ...selected, points: selected.points.slice(0, -1) })}><Undo2 className="h-4 w-4" /> Undo point</MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="config-page-button" disabled={!selected?.points.length} onClick={() => selected && replaceZone({ ...selected, points: [] })}><Trash2 className="h-4 w-4" /> Redraw polygon</MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="config-page-button" onClick={() => setFrameVersion(Date.now())}><RotateCcw className="h-4 w-4" /> Refresh frame</MomentaryFeedbackButton>
          <MomentaryFeedbackButton type="button" className="config-page-button" disabled={saving} onClick={() => void save()}>{saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Save zones</MomentaryFeedbackButton>
        </div>
        <span className="text-xs text-neutral-400">{message}</span>
      </div>
      <div className="camera-reference-gallery">
        <div><p className="camera-events-kicker">Reference gallery</p><h4>Household cats and black ute</h4></div>
        <div className="camera-analysis-zone-tabs">
          {(["cat", "ute"] as const).map((kind) => <button key={kind} type="button" className={referenceKind === kind ? "is-active" : ""} style={{ "--zone-color": kind === "cat" ? "#54f5d0" : "#ffd56b" } as React.CSSProperties} onClick={() => setReferenceKind(kind)}>{kind}</button>)}
        </div>
        <div className="camera-reference-add">
          <input aria-label="Reference name" placeholder={referenceKind === "cat" ? "Cat name" : "Black ute"} value={referenceName} onChange={(event) => setReferenceName(event.target.value)} />
          <label className="config-page-button"><ImagePlus className="h-4 w-4" /> {referenceFile?.name ?? "Choose image"}<input type="file" accept="image/*" onChange={(event) => setReferenceFile(event.target.files?.[0] ?? null)} /></label>
          <MomentaryFeedbackButton type="button" className="config-page-button" disabled={saving || !referenceFile || !referenceName.trim()} onClick={() => void uploadReference()}><Save className="h-4 w-4" /> Add reference</MomentaryFeedbackButton>
        </div>
        <ul className="camera-reference-list">
          {references.map((reference) => <li key={reference.id}><span>{reference.kind} · {reference.name}</span><button type="button" aria-label={`Delete ${reference.name} reference`} onClick={() => void deleteReference(reference.id)}><Trash2 className="h-4 w-4" /></button></li>)}
        </ul>
        <p className="text-xs text-neutral-400">Use at least five varied daylight images per cat and several parked positions/wheel views for the ute. Matches remain tentative unless calibration reaches the required confidence.</p>
      </div>
    </section>
  );
}
