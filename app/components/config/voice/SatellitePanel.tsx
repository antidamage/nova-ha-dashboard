"use client";

import { RefreshCw, Satellite } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { SlideSwitch } from "../../SlideSwitch";
import type { SatelliteRow, VoiceRoomOption } from "./types";
import { satelliteStatusText } from "./voice-infrastructure-model";

export function SatellitePanel() {
  const [satellites, setSatellites] = useState<SatelliteRow[]>([]);
  const [rooms, setRooms] = useState<VoiceRoomOption[]>([]);
  const [voiceHostOk, setVoiceHostOk] = useState(true);
  const [reconnecting, setReconnecting] = useState<string | null>(null);
  const [savingRoom, setSavingRoom] = useState<string | null>(null);
  const [togglingVoice, setTogglingVoice] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/voice/satellites", { cache: "no-store" });
      if (!response.ok) {
        return;
      }
      const data = await response.json() as {
        voiceHost?: { ok?: boolean };
        rooms?: VoiceRoomOption[];
        satellites?: SatelliteRow[];
      };
      setSatellites(Array.isArray(data.satellites) ? data.satellites : []);
      setRooms(Array.isArray(data.rooms) ? data.rooms : []);
      setVoiceHostOk(data.voiceHost?.ok !== false);
    } catch (error) {
      console.error("[nova-dashboard] failed to load voice satellites", error);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [load]);

  const reconnect = useCallback(async (row: SatelliteRow) => {
    setReconnecting(row.id);
    setMessage(`Restarting the satellite service on ${row.name}…`);
    try {
      const response = await fetch("/api/voice/satellites/reconnect", {
        body: JSON.stringify({ id: row.id }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Reconnect failed: ${response.status}`);
      }
      setMessage(`${row.name}: satellite service restarted — it reconnects on its own within seconds.`);
    } catch (error) {
      setMessage(`${row.name}: ${error instanceof Error ? error.message : "reconnect failed"}`);
    } finally {
      setReconnecting(null);
      // Give the relaunched process a moment to complete its handshake before
      // the status line refreshes.
      window.setTimeout(() => void load(), 4_000);
    }
  }, [load]);

  const setVoiceEnabled = useCallback(async (row: SatelliteRow, voiceEnabled: boolean) => {
    setTogglingVoice(row.id);
    setSatellites((current) =>
      current.map((item) => (item.id === row.id ? { ...item, voiceEnabled } : item)));
    setMessage(`${row.name}: turning satellite voice ${voiceEnabled ? "on" : "off"}…`);
    try {
      const response = await fetch("/api/voice/satellites", {
        body: JSON.stringify({ id: row.id, voiceEnabled }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as { error?: string };
      if (!response.ok) {
        throw new Error(data.error || `Voice toggle failed: ${response.status}`);
      }
      setMessage(
        voiceEnabled
          ? `${row.name}: satellite voice on — it captures speech again.`
          : `${row.name}: satellite voice off — its microphone is ignored until turned back on.`,
      );
    } catch (error) {
      setMessage(`${row.name}: ${error instanceof Error ? error.message : "failed to toggle voice"}`);
      void load();
    } finally {
      setTogglingVoice(null);
      window.setTimeout(() => void load(), 2_000);
    }
  }, [load]);

  const setRoom = useCallback(async (row: SatelliteRow, roomId: string) => {
    setSavingRoom(row.id);
    setSatellites((current) =>
      current.map((item) => (item.id === row.id ? { ...item, configuredRoomId: roomId } : item)));
    const roomName = rooms.find((room) => room.id === roomId)?.name ?? "Unassigned";
    try {
      const response = await fetch("/api/voice/satellites", {
        body: JSON.stringify({ id: row.id, roomId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      const data = await response.json() as { error?: string; pushed?: boolean; pushError?: string };
      if (!response.ok) {
        throw new Error(data.error || `Room assignment failed: ${response.status}`);
      }
      if (!roomId) {
        setMessage(`${row.name}: grouped as unassigned on the dashboard.`);
      } else if (data.pushed) {
        setMessage(`${row.name}: moved to ${roomName} and synced to the satellite.`);
      } else {
        setMessage(`${row.name}: grouped as ${roomName} on the dashboard. ${data.pushError ?? ""}`.trim());
      }
    } catch (error) {
      setMessage(`${row.name}: ${error instanceof Error ? error.message : "failed to set room"}`);
    } finally {
      setSavingRoom(null);
      window.setTimeout(() => void load(), 3_000);
    }
  }, [load, rooms]);

  if (satellites.length === 0) {
    return null;
  }

  return (
    <div className="mb-4 grid gap-2">
      <p className="text-xs font-black uppercase text-neutral-400">Satellites</p>
      {satellites.map((row) => {
        const status = satelliteStatusText(row, voiceHostOk);
        return (
          <div
            key={row.id}
            className="intensity-panel flex flex-wrap items-center justify-between gap-3 border border-cyan-300/30 bg-neutral-900/80 p-3"
          >
            <div className="flex min-w-0 items-center gap-3">
              <Satellite className="h-5 w-5 shrink-0 text-cyan-200" aria-hidden="true" />
              <div className="min-w-0">
                <p className="truncate text-sm font-black uppercase text-cyan-200">{row.name}</p>
                <p
                  className={`text-xs font-semibold ${
                    status.tone === "ok"
                      ? "text-cyan-200/80"
                      : status.tone === "warning"
                        ? "text-yellow-200"
                        : "text-red-200"
                  }`}
                >
                  {status.text}
                  {row.status?.roomId ? ` · ${row.status.roomId}` : ""}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <label className="grid gap-1 text-xs font-black uppercase text-neutral-400">
                <span>Room</span>
                <select
                  className="cyber-text-input"
                  value={row.configuredRoomId}
                  disabled={savingRoom !== null}
                  onChange={(event) => void setRoom(row, event.target.value)}
                >
                  <option value="">Unassigned</option>
                  {rooms.map((room) => (
                    <option key={room.id} value={room.id}>{room.name}</option>
                  ))}
                </select>
              </label>
              <SlideSwitch
                checked={row.voiceEnabled}
                disabled={togglingVoice !== null}
                label={`Turn satellite voice ${row.voiceEnabled ? "off" : "on"} for ${row.name}`}
                onChange={() => void setVoiceEnabled(row, !row.voiceEnabled)}
              />
              <MomentaryFeedbackButton
                type="button"
                className="config-page-button"
                disabled={reconnecting !== null || !row.enabled}
                onClick={() => void reconnect(row)}
              >
                <RefreshCw
                  className={`h-4 w-4 ${reconnecting === row.id ? "animate-spin" : ""}`}
                  aria-hidden="true"
                />
                Reconnect
              </MomentaryFeedbackButton>
            </div>
          </div>
        );
      })}
      {message ? <p role="status" className="text-xs font-semibold text-neutral-300">{message}</p> : null}
      <p className="font-sans text-xs leading-snug text-neutral-500">
        Room options come from Home Assistant&apos;s areas — the same ones the lighting sub-zones use.
        Choosing one saves the grouping here and syncs it to the satellite itself over SSH, restarting
        its service so it re-announces in the new room. Reconnect restarts the satellite service on that
        computer over SSH — the same recovery used when a satellite drops off or wedges. It relaunches
        and reconnects to the voice server by itself. Voice on/off is a per-satellite killswitch: turning
        it off makes the voice server ignore that satellite&apos;s microphone (so you can test other
        devices) while the satellite stays running and connected — no SSH, instant, and reversible.
      </p>
    </div>
  );
}
