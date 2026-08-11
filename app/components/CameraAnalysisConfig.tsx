"use client";

import { Bell, BellOff, ImagePlus, Loader2, Moon, MousePointer2, RotateCcw, Save, SunMedium, Trash2, Undo2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { NormalizedRectangle } from "../../lib/reference-selection";
import { MomentaryFeedbackButton } from "./MomentaryFeedbackButton";
import { VehicleReferenceEditor } from "./VehicleReferenceEditor";

type Point = [number, number];
type SceneZone = { id: string; label: string; kind: "activity" | "vehicle" | "exclude"; points: Point[] };
type AnalysisSettings = { enabled: boolean; alertsEnabled: boolean; zones: SceneZone[] };
type ReferenceKind = "cat" | "vehicle" | "person";
type ReferenceImage = {
  id: string;
  kind: ReferenceKind;
  name: string;
  role?: "owner" | null;
  source_name?: string | null;
  crop?: NormalizedRectangle | null;
  legacy?: boolean;
  created_at: string;
};

const COLORS: Record<SceneZone["kind"], string> = { activity: "#54f5d0", vehicle: "#ffd56b", exclude: "#ff6b80" };

export function CameraAnalysisConfig({ cameraId }: { cameraId: string }) {
  const [settings, setSettings] = useState<AnalysisSettings | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState("Loading analysis zones…");
  const [saving, setSaving] = useState(false);
  const [frameVersion, setFrameVersion] = useState(Date.now());
  const [frameMode, setFrameMode] = useState<"daylight" | "live">("daylight");
  const [references, setReferences] = useState<ReferenceImage[]>([]);
  const [referenceKind, setReferenceKind] = useState<ReferenceKind>("cat");
  const [referenceName, setReferenceName] = useState("");
  const [referenceFile, setReferenceFile] = useState<File | null>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const draggingRef = useRef<{ pointerId: number; pointIndex: number; before: AnalysisSettings; changed: boolean } | null>(null);
  const historyRef = useRef<AnalysisSettings[]>([]);
  const [historyDepth, setHistoryDepth] = useState(0);

  const remember = useCallback((value: AnalysisSettings) => {
    historyRef.current = [...historyRef.current.slice(-99), value];
    setHistoryDepth(historyRef.current.length);
  }, []);

  const undoLastChange = useCallback(() => {
    const previous = historyRef.current.pop();
    if (!previous) return false;
    setSettings(previous);
    setHistoryDepth(historyRef.current.length);
    setMessage("Last polygon change undone. Save zones when the polygon is correct.");
    return true;
  }, []);

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
        historyRef.current = [];
        setHistoryDepth(0);
        setSelectedId(value.zones[0]?.id ?? null);
        setMessage("Drag an existing point to refine it, or click empty space to add a point.");
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
    if (!settings) return;
    remember(settings);
    setSettings({ ...settings, zones: settings.zones.map((item) => item.id === zone.id ? zone : item) });
  }, [remember, settings]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== "z" || event.altKey || event.shiftKey) return;
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (target?.closest("input, textarea, select, [contenteditable='true']")) return;
      if (undoLastChange()) event.preventDefault();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [undoLastChange]);

  const addPoint = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!selected || !settings || !stageRef.current) return;
    const rect = stageRef.current.getBoundingClientRect();
    const point: Point = [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    ];
    const nearest = selected.points.reduce((best, candidate, index) => {
      const distance = Math.hypot(candidate[0] - point[0], candidate[1] - point[1]);
      return distance < best.distance ? { index, distance } : best;
    }, { index: -1, distance: Number.POSITIVE_INFINITY });
    if (nearest.distance <= 0.04) {
      draggingRef.current = { pointerId: event.pointerId, pointIndex: nearest.index, before: settings, changed: false };
      stageRef.current.setPointerCapture(event.pointerId);
      setMessage(`Dragging point ${nearest.index + 1} of ${selected.label}.`);
      return;
    }
    replaceZone({ ...selected, points: [...selected.points, point] });
  }, [replaceZone, selected, settings]);

  const dragPoint = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const dragging = draggingRef.current;
    if (!dragging || dragging.pointerId !== event.pointerId || !stageRef.current || !selectedId) return;
    if (!dragging.changed) {
      remember(dragging.before);
      dragging.changed = true;
    }
    const rect = stageRef.current.getBoundingClientRect();
    const point: Point = [
      Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    ];
    setSettings((current) => current ? {
      ...current,
      zones: current.zones.map((zone) => zone.id === selectedId ? {
        ...zone,
        points: zone.points.map((value, index) => index === dragging.pointIndex ? point : value),
      } : zone),
    } : current);
  }, [remember, selectedId]);

  const finishDrag = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (draggingRef.current?.pointerId !== event.pointerId) return;
    const changed = draggingRef.current.changed;
    draggingRef.current = null;
    if (stageRef.current?.hasPointerCapture(event.pointerId)) stageRef.current.releasePointerCapture(event.pointerId);
    if (changed) setMessage("Point moved. Save zones when the polygon is correct.");
  }, []);

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

  const uploadReference = useCallback(async (options?: {
    crop?: NormalizedRectangle;
    file?: File;
    kind?: ReferenceKind;
    name?: string;
  }) => {
    const file = options?.file ?? referenceFile;
    const kind = options?.kind ?? referenceKind;
    const name = options?.name?.trim() ?? referenceName.trim();
    if (!file || !name) {
      setMessage("Choose an image and enter the reference name first.");
      return false;
    }
    const body = new FormData();
    body.set("kind", kind);
    body.set("name", name);
    if (kind === "person") body.set("role", "owner");
    if (options?.crop) body.set("crop", JSON.stringify(options.crop));
    body.set("sourceName", file.name);
    body.set("image", file);
    setSaving(true);
    try {
      const response = await fetch(`/api/camera/${cameraId}/analysis/references`, { method: "POST", body });
      const result = await response.json().catch(() => ({})) as { detail?: string; error?: string };
      if (!response.ok) throw new Error(result.detail ?? result.error ?? "Could not save that reference image");
      if (kind !== "vehicle") {
        setReferenceFile(null);
        setReferenceName("");
      }
      await loadReferences();
      setMessage(`${name} reference saved for detailed matching.`);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save that reference image");
      return false;
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
      <div ref={stageRef} className="camera-analysis-stage" data-nova-no-drag-scroll onPointerDown={addPoint} onPointerMove={dragPoint} onPointerUp={finishDrag} onPointerCancel={finishDrag}>
        <img src={`/api/camera/${cameraId}/analysis/frame?daylight=${frameMode === "daylight"}&v=${frameVersion}`} alt={`${frameMode === "daylight" ? "Daytime reference" : "Current"} Outside camera frame for zone calibration`} draggable={false} />
        <svg viewBox="0 0 1000 562.5" preserveAspectRatio="none" aria-hidden="true">
          {settings.zones.map((zone) => (
            <g key={zone.id} opacity={selectedId === zone.id ? 1 : 0.45}>
              <polygon points={zone.points.map(([x, y]) => `${x * 1000},${y * 562.5}`).join(" ")} fill={`${COLORS[zone.kind]}26`} stroke={COLORS[zone.kind]} strokeWidth={selectedId === zone.id ? 4 : 2} vectorEffect="non-scaling-stroke" />
              {selectedId === zone.id ? zone.points.map(([x, y], index) => <circle key={index} cx={x * 1000} cy={y * 562.5} r="10" fill={COLORS[zone.kind]} stroke="#05070a" strokeWidth="3" vectorEffect="non-scaling-stroke" />) : null}
            </g>
          ))}
        </svg>
      </div>
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
      <div className="camera-reference-gallery">
        <div><p className="camera-events-kicker">Reference gallery</p><h4>Recognised household subjects</h4></div>
        <div className="camera-analysis-zone-tabs">
          {(["cat", "vehicle", "person"] as const).map((kind) => <button key={kind} type="button" className={referenceKind === kind ? "is-active" : ""} style={{ "--zone-color": kind === "cat" ? "#54f5d0" : kind === "vehicle" ? "#ffd56b" : "#8bb8ff" } as React.CSSProperties} onClick={() => { setReferenceKind(kind); setReferenceFile(null); }}>{kind === "person" ? "owner" : kind}</button>)}
        </div>
        <div className="camera-reference-add">
          {referenceKind !== "vehicle" ? <input aria-label="Reference name" placeholder={referenceKind === "cat" ? "Cat name" : "Owner name"} value={referenceName} onChange={(event) => setReferenceName(event.target.value)} /> : null}
          <label className="config-page-button"><ImagePlus className="h-4 w-4" /> {referenceFile?.name ?? (referenceKind === "vehicle" ? "Choose photo and designate" : "Choose image")}<input type="file" accept="image/*" onChange={(event) => { setReferenceFile(event.target.files?.[0] ?? null); event.currentTarget.value = ""; }} /></label>
          {referenceKind !== "vehicle" ? <MomentaryFeedbackButton type="button" className="config-page-button" disabled={saving || !referenceFile || !referenceName.trim()} onClick={() => void uploadReference()}><Save className="h-4 w-4" /> Add reference</MomentaryFeedbackButton> : null}
        </div>
        <ul className="camera-reference-list">
          {references.filter((reference) => reference.kind === referenceKind).map((reference) => <li key={reference.id}>
            <img src={`/api/camera/${cameraId}/analysis/references/${reference.id}/image`} alt="" />
            <span><strong>{reference.name}</strong><small>{reference.legacy ? "Legacy whole-photo reference" : reference.crop ? `Designated from ${reference.source_name ?? "photo"}` : reference.kind === "person" ? "Owner reference" : "Image reference"}</small></span>
            <button type="button" aria-label={`Delete ${reference.name} reference`} onClick={() => void deleteReference(reference.id)}><Trash2 className="h-4 w-4" /></button>
          </li>)}
        </ul>
        {references.every((reference) => reference.kind !== referenceKind) ? <p className="camera-reference-empty">No {referenceKind === "person" ? "owner" : referenceKind} references remembered yet.</p> : null}
        <p className="text-xs text-neutral-400">For vehicles, designate the vehicle tightly in several daylight photos from different angles. Cat and owner references should also use varied close views. Recognition remains tentative unless local analysis agrees across multiple event frames.</p>
      </div>
      {referenceKind === "vehicle" && referenceFile ? <VehicleReferenceEditor
        file={referenceFile}
        initialName={referenceName}
        saving={saving}
        onClose={() => setReferenceFile(null)}
        onSave={(name, crop) => uploadReference({ crop, file: referenceFile, kind: "vehicle", name })}
      /> : null}
    </section>
  );
}
