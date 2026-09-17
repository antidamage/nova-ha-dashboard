"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { AnalysisSettings, Point, SceneZone } from "./types";

// The polygon editor's state and geometry. Points are normalised to the source
// frame — a pointer position becomes a 0..1 fraction of the stage rectangle and
// is stored that way, so zones survive any change of preview size.
export function useSceneZones({
  cameraId,
  setMessage,
  setSaving,
}: {
  cameraId: string;
  setMessage: (message: string) => void;
  setSaving: (saving: boolean) => void;
}) {
  const [settings, setSettings] = useState<AnalysisSettings | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
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

  return {
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
  };
}
