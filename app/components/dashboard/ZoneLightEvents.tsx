"use client";

import { ArrowDown, ArrowUp, Plus, Trash2, Zap } from "lucide-react";
import { useState } from "react";
import type { DashboardEntity, DashboardZone } from "../../../lib/types";
import type { ReminderGlyph } from "../../../lib/reminder-glyph";
import {
  WHITE_RULE_VALUE,
  isBuiltinRuleId,
  type ZoneLightRule,
  type ZoneLightRuleKind,
  type ZoneLightRuleValue,
} from "../../../lib/zone-light-rules";
import { ConfigSelect } from "../ConfigSelect";
import { IconButton } from "./IconButton";
import { SlideSwitch } from "../SlideSwitch";
import { hsvToRgb } from "../colorEncoderModel";
import { ReminderIconPicker } from "../reminders/ReminderIconPicker";
import { ZoneColorEncoder } from "./ZoneControls";
import { RuleIcon, triggerRulePreset, useZoneLightRules, type RulePresetHandlers } from "./zoneLightRulesClient";

/**
 * Every lighting rule for the zone — timed events, adaptive candlelight,
 * intensity thresholds, pinned fixtures and presets — and which of its lights
 * an event may switch on. The host owns and fires the rules; this reads and
 * edits them (specs/zone-light-events.md).
 */

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];
const HOURS = Array.from({ length: 24 }, (_, hour) => String(hour).padStart(2, "0"));
const MINUTES = Array.from({ length: 12 }, (_, index) => String(index * 5).padStart(2, "0"));
const SUN_OFFSETS = Array.from({ length: 17 }, (_, index) => (index - 8) * 15);
const PERCENTS = Array.from({ length: 101 }, (_, pct) => String(pct));

const KIND_LABELS: Record<ZoneLightRuleKind, string> = {
  event: "Timed event",
  adaptive: "Adaptive",
  threshold: "Intensity threshold",
  pinned: "Pinned",
  preset: "Preset",
};

function offsetLabel(minutes: number) {
  if (minutes === 0) return "on the dot";
  const sign = minutes < 0 ? "−" : "+";
  return `${sign}${Math.abs(minutes)} min`;
}

function newRule(kind: ZoneLightRuleKind, zone: DashboardZone, lights: DashboardEntity[]): ZoneLightRule {
  const base = { id: "", zoneId: zone.id, enabled: true, name: KIND_LABELS[kind] };
  const firstLight = lights[0]?.entity_id;
  switch (kind) {
    case "event":
      return { ...base, kind, at: { kind: "clock", hhmm: "18:00" }, days: [], value: { hue: 30, saturation: 60, brightnessPct: 60 } };
    case "adaptive":
      return { ...base, kind };
    case "threshold":
      return { ...base, kind, thresholdPct: 50, entityIds: firstLight ? [firstLight] : [] };
    case "pinned":
      return { ...base, kind, entityIds: firstLight ? [firstLight] : [] };
    default:
      return { ...base, kind: "preset", value: { ...WHITE_RULE_VALUE, hue: 30, saturation: 60 }, preset: { show: true, order: 0 } };
  }
}

function ValueEncoder({
  ruleId,
  value,
  zoneId,
  onCommit,
}: {
  ruleId: string;
  value: ZoneLightRuleValue;
  zoneId: string;
  onCommit: (value: ZoneLightRuleValue) => void;
}) {
  // The dial moves locally while dragged and saves on release.
  const [draft, setDraft] = useState<ZoneLightRuleValue | null>(null);
  const shown = draft ?? value;
  return (
    <ZoneColorEncoder
      brightness={shown.brightnessPct}
      colorEnabled
      disabled={false}
      label="Sets"
      size={100}
      spectrum={{
        cursor: { x: shown.hue / 359, y: 1 - shown.saturation / 100 },
        preview: hsvToRgb(shown.hue, shown.saturation, 100),
      }}
      zoneId={`${zoneId}:${ruleId}`}
      onBrightnessChange={(brightnessPct) => setDraft({ ...shown, brightnessPct })}
      onBrightnessCommit={(brightnessPct) => {
        setDraft(null);
        onCommit({ ...shown, brightnessPct });
      }}
      onColorCommit={(_rgb, brightnessPct, cursor) => {
        setDraft(null);
        onCommit({ hue: Math.round(cursor.x * 359), saturation: Math.round((1 - cursor.y) * 100), brightnessPct });
      }}
      onSpectrumChange={(spectrum) =>
        setDraft({ ...shown, hue: Math.round(spectrum.cursor.x * 359), saturation: Math.round((1 - spectrum.cursor.y) * 100) })}
    />
  );
}

function EntityToggles({
  candidates,
  selected,
  label,
  onChange,
}: {
  candidates: DashboardEntity[];
  selected: string[];
  label: string;
  onChange: (entityIds: string[]) => void;
}) {
  // Entities listed by a rule but not (or no longer) in the zone still show,
  // so a migrated rule never hides what it drives.
  const known = new Set(candidates.map((entity) => entity.entity_id));
  const rows = [
    ...candidates.map((entity) => ({ id: entity.entity_id, name: entity.name })),
    ...selected.filter((id) => !known.has(id)).map((id) => ({ id, name: id })),
  ];
  return (
    <div className="zone-light-event-switch-ons">
      {rows.map((row) => (
        <div key={row.id} className="zone-light-event-switch-on">
          <span className="zone-lighting-label">{row.name}</span>
          <SlideSwitch
            checked={selected.includes(row.id)}
            label={`${label} ${row.name}`}
            onChange={() => {
              const next = selected.includes(row.id) ? selected.filter((id) => id !== row.id) : [...selected, row.id];
              if (next.length) onChange(next);
            }}
          />
        </div>
      ))}
    </div>
  );
}

function EventEditor({ rule, onUpdate }: { rule: Extract<ZoneLightRule, { kind: "event" }>; onUpdate: (patch: Partial<ZoneLightRule>) => void }) {
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

export function ZoneLightEvents({
  lights,
  zone,
  presetHandlers,
}: {
  lights: DashboardEntity[];
  zone: DashboardZone;
  /** The zone card's own preset path, so "Now" moves the dial as a preset press does. */
  presetHandlers?: RulePresetHandlers;
}) {
  const { error, loaded, rules, switchOnEntityIds, create, update, remove, reorder, setSwitchOn } = useZoneLightRules(zone.id);
  const [addKind, setAddKind] = useState<ZoneLightRuleKind>("preset");
  const [iconRuleId, setIconRuleId] = useState<string | null>(null);
  const switchables = zone.entities.filter((entity) => entity.domain === "light" || entity.domain === "switch");
  const custom = rules.filter((rule) => !isBuiltinRuleId(rule.id));
  const presetOrder = custom
    .filter((rule) => rule.preset?.show)
    .sort((left, right) => (left.preset!.order - right.preset!.order));
  const iconRule = custom.find((rule) => rule.id === iconRuleId) ?? null;

  const move = (rule: ZoneLightRule, delta: number) => {
    const ids = presetOrder.map((entry) => entry.id);
    const index = ids.indexOf(rule.id);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target], ids[index]];
    void reorder(ids);
  };

  const trigger = (rule: ZoneLightRule) => {
    if (presetHandlers) {
      void triggerRulePreset(rule, presetHandlers);
    } else {
      void fetch(`/api/lighting/zone-rules/${encodeURIComponent(rule.id)}/trigger`, { method: "POST" });
    }
  };

  return (
    <section className="advanced-fold-row zone-light-events">
      <header className="zone-light-events-header">
        <h2 className="zone-light-events-title">Lighting rules</h2>
        <div className="zone-light-rule-add">
          <ConfigSelect
            ariaLabel="Rule type"
            value={addKind}
            options={(Object.keys(KIND_LABELS) as ZoneLightRuleKind[]).map((kind) => ({ value: kind, label: KIND_LABELS[kind] }))}
            onChange={(kind) => setAddKind(kind as ZoneLightRuleKind)}
          />
          <IconButton label="Add a lighting rule" variant="yellow" onClick={() => void create(newRule(addKind, zone, lights))}>
            <Plus aria-hidden="true" /><span>Add</span>
          </IconButton>
        </div>
      </header>

      {error ? <p className="zone-lighting-detail">{error}</p> : null}
      {!loaded && !error ? <p className="zone-lighting-detail">Loading…</p> : null}

      {rules.map((rule) => {
        const builtin = isBuiltinRuleId(rule.id);
        const orderIndex = presetOrder.findIndex((entry) => entry.id === rule.id);
        return (
          <article key={rule.id} className="zone-light-event zone-light-rule border" data-rule-kind={rule.kind} data-rule-id={rule.id}>
            <div className="zone-light-event-row zone-light-rule-head">
              <RuleIcon rule={rule} className="zone-light-rule-icon" />
              <span className="zone-lighting-label zone-light-rule-name">{rule.name ?? KIND_LABELS[rule.kind]}</span>
              <span className="zone-lighting-detail">{builtin ? "Built in" : KIND_LABELS[rule.kind]}</span>
              {builtin ? null : (
                <SlideSwitch
                  checked={rule.enabled}
                  label={`Enable ${rule.name ?? KIND_LABELS[rule.kind]}`}
                  onChange={() => void update(rule.id, { enabled: !rule.enabled })}
                />
              )}
              <IconButton label={`Apply ${rule.name ?? KIND_LABELS[rule.kind]} now`} variant="yellow" onClick={() => trigger(rule)}>
                <Zap aria-hidden="true" /><span>Now</span>
              </IconButton>
            </div>

            {rule.kind === "event" ? <EventEditor rule={rule} onUpdate={(patch) => void update(rule.id, patch)} /> : null}

            {rule.kind === "threshold" ? (
              <>
                <div className="zone-light-event-row">
                  <span className="zone-lighting-label">On at or above</span>
                  <ConfigSelect
                    ariaLabel="Threshold percent"
                    value={String(rule.thresholdPct)}
                    options={PERCENTS.map((pct) => ({ value: pct, label: `${pct}%` }))}
                    onChange={(pct) => void update(rule.id, { thresholdPct: Number(pct) })}
                  />
                </div>
                <EntityToggles
                  candidates={switchables}
                  label="Threshold drives"
                  selected={rule.entityIds}
                  onChange={(entityIds) => void update(rule.id, { entityIds })}
                />
              </>
            ) : null}

            {rule.kind === "pinned" ? (
              <EntityToggles
                candidates={lights}
                label="Pin"
                selected={rule.entityIds}
                onChange={(entityIds) => void update(rule.id, { entityIds })}
              />
            ) : null}

            {(rule.kind === "event" || (rule.kind === "preset" && !builtin)) ? (
              <div className="zone-light-event-value">
                <ValueEncoder
                  ruleId={rule.id}
                  value={rule.value}
                  zoneId={zone.id}
                  onCommit={(value) => void update(rule.id, { value })}
                />
                <p className="zone-lighting-detail">
                  {rule.value.brightnessPct === 0 ? "Off, the switched lights included." : `${rule.value.brightnessPct}%`}
                </p>
              </div>
            ) : null}

            {builtin ? null : (
              <div className="zone-light-event-row zone-light-rule-preset">
                <span className="zone-lighting-label">Preset button</span>
                <SlideSwitch
                  checked={Boolean(rule.preset?.show)}
                  label={`Show ${rule.name ?? KIND_LABELS[rule.kind]} as a preset`}
                  onChange={() =>
                    void update(rule.id, {
                      preset: {
                        show: !rule.preset?.show,
                        ...(rule.preset?.icon ? { icon: rule.preset.icon } : {}),
                        order: rule.preset?.show ? rule.preset.order : Math.max(0, ...custom.map((entry) => entry.preset?.order ?? 0)) + 1,
                      },
                    })}
                />
                <IconButton label={`Icon for ${rule.name ?? KIND_LABELS[rule.kind]}`} variant="white" onClick={() => setIconRuleId(rule.id)}>
                  <RuleIcon rule={rule} /><span>Icon</span>
                </IconButton>
                {orderIndex >= 0 ? (
                  <>
                    <IconButton label="Move preset earlier" disabled={orderIndex === 0} variant="white" onClick={() => move(rule, -1)}>
                      <ArrowUp aria-hidden="true" />
                    </IconButton>
                    <IconButton label="Move preset later" disabled={orderIndex === presetOrder.length - 1} variant="white" onClick={() => move(rule, 1)}>
                      <ArrowDown aria-hidden="true" />
                    </IconButton>
                  </>
                ) : null}
                <IconButton label={`Delete ${rule.name ?? KIND_LABELS[rule.kind]}`} variant="pink" onClick={() => void remove(rule.id)}>
                  <Trash2 aria-hidden="true" /><span>Delete</span>
                </IconButton>
              </div>
            )}
          </article>
        );
      })}

      {iconRule ? (
        <ReminderIconPicker
          glyph={iconRule.preset?.icon ?? { kind: "phosphor", id: "lightning" }}
          open
          reminderName={iconRule.name ?? KIND_LABELS[iconRule.kind]}
          onClose={() => setIconRuleId(null)}
          onSelect={(icon: ReminderGlyph) => {
            setIconRuleId(null);
            void update(iconRule.id, { preset: { show: iconRule.preset?.show ?? false, icon, order: iconRule.preset?.order ?? 0 } });
          }}
        />
      ) : null}

      {lights.length ? (
        <div className="zone-light-event-switch-ons">
          <h3 className="zone-light-events-subtitle">An event may switch these on</h3>
          {lights.map((light) => (
            <div key={light.entity_id} className="zone-light-event-switch-on">
              <span className="zone-lighting-label">{light.name}</span>
              <SlideSwitch
                checked={switchOnEntityIds.includes(light.entity_id)}
                label={`Let an event switch on ${light.name}`}
                onChange={() => {
                  const on = switchOnEntityIds.includes(light.entity_id);
                  void setSwitchOn(on
                    ? switchOnEntityIds.filter((entityId) => entityId !== light.entity_id)
                    : [...switchOnEntityIds, light.entity_id]);
                }}
              />
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
