"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { DashboardEntity, DashboardZone } from "../../../../lib/types";
import type { ReminderGlyph } from "../../../../lib/reminder-glyph";
import {
  isBuiltinRuleId,
  type ZoneLightRule,
  type ZoneLightRuleKind,
} from "../../../../lib/zone-light-rules";
import { ConfigSelect } from "../../ConfigSelect";
import { IconButton } from "../IconButton";
import { SlideSwitch } from "../../SlideSwitch";
import { ReminderIconPicker } from "../../reminders/ReminderIconPicker";
import { RuleIcon, useZoneLightRules } from "../zoneLightRulesClient";
import { KIND_LABELS, PERCENTS } from "./constants";
import { newRule } from "./zone-model";
import { EntityToggles } from "./EntityToggles";
import { EventEditor } from "./EventEditor";
import { ValueEncoder } from "./ValueEncoder";

/**
 * Every lighting rule for the zone — timed events, adaptive candlelight,
 * intensity thresholds, pinned fixtures and presets — and which of its lights
 * an event may switch on. The host owns and fires the rules; this reads and
 * edits them (specs/zone-light-events.md).
 */

export function ZoneLightEvents({
  lights,
  zone,
}: {
  lights: DashboardEntity[];
  zone: DashboardZone;
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
