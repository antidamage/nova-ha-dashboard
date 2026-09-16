"use client";

import type { ZoneLightRule } from "../../../../lib/zone-light-rules";
import { ConfigSelect } from "../../ConfigSelect";
import { IconButton } from "../IconButton";
import { DAY_LABELS, HOURS, MINUTES, SUN_OFFSETS } from "./constants";
import { offsetLabel } from "./zone-model";

export function EventEditor({ rule, onUpdate }: { rule: Extract<ZoneLightRule, { kind: "event" }>; onUpdate: (patch: Partial<ZoneLightRule>) => void }) {
  return (
    <>
      <div className="zone-light-event-row">
        <ConfigSelect
          ariaLabel="Event trigger"
          value={rule.at.kind}
          options={[
            { value: "clock", label: "At a time" },
            { value: "sun", label: "Sunrise or sunset" },
          ]}
          onChange={(kind) =>
            onUpdate({ at: kind === "clock" ? { kind: "clock", hhmm: "18:00" } : { kind: "sun", event: "sunset", offsetMinutes: 0 } })}
        />
        {rule.at.kind === "clock" ? (
          <>
            <ConfigSelect
              ariaLabel="Hour"
              value={rule.at.hhmm.slice(0, 2)}
              options={HOURS.map((hour) => ({ value: hour, label: hour }))}
              onChange={(hour) => onUpdate({ at: { kind: "clock", hhmm: `${hour}:${(rule.at as { hhmm: string }).hhmm.slice(3)}` } })}
            />
            <ConfigSelect
              ariaLabel="Minute"
              value={MINUTES.includes(rule.at.hhmm.slice(3)) ? rule.at.hhmm.slice(3) : "00"}
              options={MINUTES.map((minute) => ({ value: minute, label: minute }))}
              onChange={(minute) => onUpdate({ at: { kind: "clock", hhmm: `${(rule.at as { hhmm: string }).hhmm.slice(0, 2)}:${minute}` } })}
            />
          </>
        ) : (
          <>
            <ConfigSelect
              ariaLabel="Sun event"
              value={rule.at.event}
              options={[
                { value: "sunrise", label: "Sunrise" },
                { value: "sunset", label: "Sunset" },
              ]}
              onChange={(sunEvent) =>
                onUpdate({ at: { kind: "sun", event: sunEvent, offsetMinutes: (rule.at as { offsetMinutes: number }).offsetMinutes } })}
            />
            <ConfigSelect
              ariaLabel="Offset"
              value={String((rule.at as { offsetMinutes: number }).offsetMinutes)}
              options={SUN_OFFSETS.map((offset) => ({ value: String(offset), label: offsetLabel(offset) }))}
              onChange={(offset) =>
                onUpdate({ at: { kind: "sun", event: (rule.at as { event: "sunrise" | "sunset" }).event, offsetMinutes: Number(offset) } })}
            />
          </>
        )}
      </div>
      <div className="zone-light-event-days" role="group" aria-label="Days this event may fire on">
        {DAY_LABELS.map((label, day) => {
          const active = rule.days.length === 0 || rule.days.includes(day);
          return (
            <IconButton
              key={day}
              label={`Day ${day}`}
              variant={active ? "yellow" : "white"}
              onClick={() => {
                const current = rule.days.length === 0 ? [0, 1, 2, 3, 4, 5, 6] : rule.days;
                const next = current.includes(day) ? current.filter((entry) => entry !== day) : [...current, day].sort();
                onUpdate({ days: next.length === 7 ? [] : next });
              }}
            >
              <span>{label}</span>
            </IconButton>
          );
        })}
      </div>
    </>
  );
}
