"use client";

import { Plus, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { DashboardEntity, DashboardZone, ZoneLightEvent } from "../../../lib/types";
import { ConfigSelect } from "../ConfigSelect";
import { IconButton } from "./IconButton";
import { SlideSwitch } from "../SlideSwitch";
import { hsvToRgb } from "../colorEncoderModel";
import { ZoneColorEncoder } from "./ZoneControls";

/**
 * The zone's timed light events, and which of its lights an event may switch
 * on. The rules live on the host and the host fires them; this only reads and
 * writes the list (specs/zone-light-events.md).
 */

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
const SUN_OFFSETS = Array.from({ length: 17 }, (_, index) => (index - 8) * 15);

type EventsPayload = { events: ZoneLightEvent[]; switchOnEntityIds: string[] };

function newEvent(zoneId: string): ZoneLightEvent {
  return {
    id: `evt-${Date.now().toString(36)}`,
    zoneId,
    enabled: true,
    at: { kind: "clock", hhmm: "18:00" },
    days: [],
    value: { hue: 30, saturation: 60, brightnessPct: 60 },
  };
}

function offsetLabel(minutes: number) {
  if (minutes === 0) return "on the dot";
  const sign = minutes < 0 ? "−" : "+";
  return `${sign}${Math.abs(minutes)} min`;
}

export function ZoneLightEvents({ lights, zone }: { lights: DashboardEntity[]; zone: DashboardZone }) {
  const [payload, setPayload] = useState<EventsPayload | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const response = await fetch("/api/lighting/zone-events");
        if (!response.ok) throw new Error("Could not read light events");
        const body = await response.json() as EventsPayload;
        if (alive) setPayload({ events: body.events ?? [], switchOnEntityIds: body.switchOnEntityIds ?? [] });
      } catch (cause) {
        if (alive) setError(cause instanceof Error ? cause.message : "Could not read light events");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const save = useCallback(async (next: EventsPayload) => {
    setPayload(next);
    setSaving(true);
    setError(null);
    try {
      const response = await fetch("/api/lighting/zone-events", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(next),
      });
      if (!response.ok) throw new Error("Could not save light events");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save light events");
    } finally {
      setSaving(false);
    }
  }, []);

  const zoneEvents = useMemo(
    () => (payload?.events ?? []).filter((event) => event.zoneId === zone.id),
    [payload, zone.id],
  );

  const updateEvent = useCallback(
    (id: string, patch: Partial<ZoneLightEvent>) => {
      if (!payload) return;
      void save({
        ...payload,
        events: payload.events.map((event) => (event.id === id ? { ...event, ...patch } : event)),
      });
    },
    [payload, save],
  );

  if (!payload) {
    return (
      <section className="advanced-fold-row zone-light-events">
        <h2 className="zone-light-events-title">Light events</h2>
        <p className="theme-display-detail">{error ?? "Loading…"}</p>
      </section>
    );
  }

  return (
    <section className="advanced-fold-row zone-light-events">
      <header className="zone-light-events-header">
        <h2 className="zone-light-events-title">Light events</h2>
        <IconButton
          label="Add a light event"
          variant="yellow"
          onClick={() => void save({ ...payload, events: [...payload.events, newEvent(zone.id)] })}
        >
          <Plus aria-hidden="true" /><span>Add</span>
        </IconButton>
      </header>

      {error ? <p className="theme-display-detail text-amber-200">{error}</p> : null}
      {!zoneEvents.length ? (
        <p className="theme-display-detail">
          Nothing timed for this zone. An event sets these lights once, at its time; anything you do
          afterwards wins.
        </p>
      ) : null}

      {zoneEvents.map((event) => (
        <article key={event.id} className="zone-light-event border">
          <div className="zone-light-event-row">
            <ConfigSelect
              ariaLabel="Event trigger"
              value={event.at.kind}
              options={[
                { value: "clock", label: "At a time" },
                { value: "sun", label: "Sunrise or sunset" },
              ]}
              onChange={(kind) =>
                updateEvent(event.id, {
                  at: kind === "clock"
                    ? { kind: "clock", hhmm: "18:00" }
                    : { kind: "sun", event: "sunset", offsetMinutes: 0 },
                })
              }
            />
            {event.at.kind === "clock" ? (
              <>
                <ConfigSelect
                  ariaLabel="Hour"
                  value={event.at.hhmm.slice(0, 2)}
                  options={HOURS.map((hour) => ({ value: hour, label: hour }))}
                  onChange={(hour) =>
                    updateEvent(event.id, { at: { kind: "clock", hhmm: `${hour}:${(event.at as { hhmm: string }).hhmm.slice(3)}` } })
                  }
                />
                <ConfigSelect
                  ariaLabel="Minute"
                  value={MINUTES.includes(event.at.hhmm.slice(3)) ? event.at.hhmm.slice(3) : "00"}
                  options={MINUTES.map((minute) => ({ value: minute, label: minute }))}
                  onChange={(minute) =>
                    updateEvent(event.id, { at: { kind: "clock", hhmm: `${(event.at as { hhmm: string }).hhmm.slice(0, 2)}:${minute}` } })
                  }
                />
              </>
            ) : (
              <>
                <ConfigSelect
                  ariaLabel="Sun event"
                  value={event.at.event}
                  options={[
                    { value: "sunrise", label: "Sunrise" },
                    { value: "sunset", label: "Sunset" },
                  ]}
                  onChange={(sunEvent) =>
                    updateEvent(event.id, {
                      at: { kind: "sun", event: sunEvent, offsetMinutes: (event.at as { offsetMinutes: number }).offsetMinutes },
                    })
                  }
                />
                <ConfigSelect
                  ariaLabel="Offset"
                  value={String((event.at as { offsetMinutes: number }).offsetMinutes)}
                  options={SUN_OFFSETS.map((offset) => ({ value: String(offset), label: offsetLabel(offset) }))}
                  onChange={(offset) =>
                    updateEvent(event.id, {
                      at: { kind: "sun", event: (event.at as { event: "sunrise" | "sunset" }).event, offsetMinutes: Number(offset) },
                    })
                  }
                />
              </>
            )}
            <SlideSwitch
              checked={event.enabled}
              label={`Enable ${event.name ?? "this light event"}`}
              onChange={() => updateEvent(event.id, { enabled: !event.enabled })}
            />
          </div>

          <div className="zone-light-event-days" role="group" aria-label="Days this event may fire on">
            {DAY_LABELS.map((label, day) => {
              const active = event.days.length === 0 || event.days.includes(day);
              return (
                <IconButton
                  key={day}
                  label={`Day ${day}`}
                  variant={active ? "yellow" : "white"}
                  onClick={() => {
                    const current = event.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : event.days;
                    const next = current.includes(day)
                      ? current.filter((entry) => entry !== day)
                      : [...current, day].sort();
                    updateEvent(event.id, { days: next.length === 7 ? [] : next });
                  }}
                >
                  <span>{label}</span>
                </IconButton>
              );
            })}
          </div>

          <div className="zone-light-event-value">
            <ZoneColorEncoder
              brightness={event.value.brightnessPct}
              colorEnabled
              disabled={false}
              label="Sets"
              size={100}
              spectrum={{
                cursor: { x: event.value.hue / 359, y: 1 - event.value.saturation / 100 },
                preview: hsvToRgb(event.value.hue, event.value.saturation, 100),
              }}
              zoneId={`${zone.id}:${event.id}`}
              onBrightnessChange={(brightnessPct) =>
                setPayload((current) => current && ({
                  ...current,
                  events: current.events.map((entry) =>
                    entry.id === event.id ? { ...entry, value: { ...entry.value, brightnessPct } } : entry),
                }))
              }
              onBrightnessCommit={(brightnessPct) =>
                updateEvent(event.id, { value: { ...event.value, brightnessPct } })
              }
              onColorCommit={(_rgb, brightnessPct, cursor) =>
                updateEvent(event.id, {
                  value: {
                    hue: Math.round(cursor.x * 359),
                    saturation: Math.round((1 - cursor.y) * 100),
                    brightnessPct,
                  },
                })
              }
              onSpectrumChange={(spectrum) =>
                setPayload((current) => current && ({
                  ...current,
                  events: current.events.map((entry) =>
                    entry.id === event.id
                      ? {
                        ...entry,
                        value: {
                          ...entry.value,
                          hue: Math.round(spectrum.cursor.x * 359),
                          saturation: Math.round((1 - spectrum.cursor.y) * 100),
                        },
                      }
                      : entry),
                }))
              }
            />
            <p className="theme-display-detail">
              {event.value.brightnessPct === 0
                ? "Switches this zone off, the switched lights included."
                : `Sets these lights to ${event.value.brightnessPct}%.`}
            </p>
            <IconButton
              label="Delete this event"
              variant="pink"
              onClick={() => void save({ ...payload, events: payload.events.filter((entry) => entry.id !== event.id) })}
            >
              <Trash2 aria-hidden="true" /><span>Delete</span>
            </IconButton>
          </div>
        </article>
      ))}

      {lights.length ? (
        <div className="zone-light-event-switch-ons">
          <h3 className="zone-light-events-subtitle">An event may switch these on</h3>
          {lights.map((light) => (
            <div key={light.entity_id} className="zone-light-event-switch-on">
              <span className="theme-display-label">{light.name}</span>
              <SlideSwitch
                checked={payload.switchOnEntityIds.includes(light.entity_id)}
                disabled={saving}
                label={`Let an event switch on ${light.name}`}
                onChange={() => {
                  const on = payload.switchOnEntityIds.includes(light.entity_id);
                  void save({
                    ...payload,
                    switchOnEntityIds: on
                      ? payload.switchOnEntityIds.filter((entityId) => entityId !== light.entity_id)
                      : [...payload.switchOnEntityIds, light.entity_id],
                  });
                }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
