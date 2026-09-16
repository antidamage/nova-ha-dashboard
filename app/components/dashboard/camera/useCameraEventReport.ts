"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { AnalysisStatus, CameraEvent } from "./types";

async function readEvents(cameraId: string, limit: number) {
  const response = await fetch(`/api/camera/${cameraId}/events?limit=${limit}`, { cache: "no-store" });
  if (!response.ok) throw new Error("Camera analysis is unavailable");
  return (await response.json()) as { events: CameraEvent[] };
}

export function useCameraEventReport(cameraId: string) {
  const [events, setEvents] = useState<CameraEvent[]>([]);
  const [status, setStatus] = useState<AnalysisStatus | null>(null);
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "important" | "animals" | "unreviewed">("all");
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedForDelete, setSelectedForDelete] = useState<Set<string>>(new Set());
  const [deleting, setDeleting] = useState(false);
  const [selecting, setSelecting] = useState(false);

  const refresh = useCallback(async (full = false) => {
    try {
      const payload = await readEvents(cameraId, full || open ? 100 : 5);
      setEvents(payload.events);
      if (!selectedId && payload.events[0]) setSelectedId(payload.events[0].id);
      setMessage(null);
      const statusResponse = await fetch(`/api/camera/${cameraId}/analysis/status`, { cache: "no-store" });
      if (statusResponse.ok) setStatus((await statusResponse.json()) as AnalysisStatus);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Camera analysis is unavailable");
    } finally {
      setLoading(false);
    }
  }, [cameraId, open, selectedId]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), open ? 10_000 : 30_000);
    return () => window.clearInterval(timer);
  }, [open, refresh]);

  const visible = useMemo(() => events.filter((event) => {
    if (filter === "important") return event.priority !== "routine";
    if (filter === "animals") return event.labels.some((label) => ["cat", "dog", "horse", "sheep", "cow"].includes(label));
    if (filter === "unreviewed") return !event.reviewed;
    return true;
  }), [events, filter]);
  const selected = events.find((event) => event.id === selectedId) ?? visible[0] ?? null;
  const importantCount = events.filter((event) => event.priority !== "routine" && !event.reviewed).length;

  const patchEvent = useCallback(async (eventId: string, patch: Partial<Pick<CameraEvent, "reviewed" | "starred">>) => {
    const response = await fetch(`/api/camera/${cameraId}/events/${eventId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!response.ok) {
      setMessage("Could not update that event.");
      return;
    }
    const updated = (await response.json()) as CameraEvent;
    setEvents((current) => current.map((item) => item.id === updated.id ? updated : item));
  }, [cameraId]);

  const deleteEvent = useCallback(async (eventId: string) => {
    if (!window.confirm("Delete this event and its recorded clip? This cannot be undone.")) return;
    const response = await fetch(`/api/camera/${cameraId}/events/${eventId}`, { method: "DELETE" });
    if (!response.ok) {
      setMessage("Could not delete that event.");
      return;
    }
    setEvents((current) => current.filter((item) => item.id !== eventId));
    setSelectedId(null);
  }, [cameraId]);

  const toggleForDelete = useCallback((eventId: string) => {
    setSelectedForDelete((current) => {
      const next = new Set(current);
      if (next.has(eventId)) next.delete(eventId); else next.add(eventId);
      return next;
    });
  }, []);

  const bulkDelete = useCallback(async () => {
    const ids = [...selectedForDelete];
    if (!ids.length || !window.confirm(`Delete ${ids.length} selected events and their recorded clips? This cannot be undone.`)) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/camera/${cameraId}/events`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!response.ok) throw new Error("Could not delete the selected events.");
      const payload = (await response.json()) as { deleted: string[] };
      const deleted = new Set(payload.deleted);
      setEvents((current) => current.filter((event) => !deleted.has(event.id)));
      if (selectedId && deleted.has(selectedId)) setSelectedId(null);
      setSelectedForDelete(new Set());
      setMessage(`${deleted.size} events deleted.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not delete the selected events.");
    } finally {
      setDeleting(false);
    }
  }, [cameraId, selectedForDelete, selectedId]);

  return {
    bulkDelete,
    deleteEvent,
    deleting,
    events,
    filter,
    importantCount,
    loading,
    message,
    open,
    patchEvent,
    refresh,
    selected,
    selectedForDelete,
    selecting,
    setFilter,
    setOpen,
    setSelectedForDelete,
    setSelectedId,
    setSelecting,
    status,
    toggleForDelete,
    visible,
  };
}
