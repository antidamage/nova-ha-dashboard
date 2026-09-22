"use client";

import { X } from "lucide-react";
import { ConfigSelect } from "../../ConfigSelect";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { ControlModuleField, ControlPreset } from "../../../../lib/control-modules/types";

/**
 * The device-binding fields (specs/control-modules.md).
 *
 * An entity id is free text — any string is a legal Home Assistant id — so these
 * are invitations rather than constraints: a picker lists what the house
 * actually has, and the id can still be typed, because a device that is not in
 * the registry yet must not be impossible to bind.
 *
 * A list keeps its ORDER, which is why it is chips and not a multi-select: the
 * temperature sensor list's order is a safety property, not a preference, and a
 * control that re-sorted it would be re-deciding which reading the thermostat
 * trusts.
 */

export type EntityOption = { id: string; name: string; domain: string };

const DOMAIN_LABEL: Record<string, string> = { climate: "Climate", sensor: "Sensors", switch: "Switches" };

export function entityOptions(entities: readonly EntityOption[], domain: string | undefined) {
  return entities
    .filter((entity) => (domain ? entity.domain === domain : true))
    .map((entity) => ({ detail: entity.id, group: DOMAIN_LABEL[entity.domain] ?? entity.domain, label: entity.name, value: entity.id }));
}

function listValue(preset: ControlPreset, fieldId: string): string[] {
  const value = (preset.binding as Record<string, unknown>)[fieldId];
  return Array.isArray(value) ? value.map(String) : [];
}

function writeList(preset: ControlPreset, fieldId: string, ids: string[]): ControlPreset {
  const binding = { ...preset.binding } as Record<string, unknown>;
  if (ids.length) {
    binding[fieldId] = ids;
  } else {
    delete binding[fieldId];
  }
  return { ...preset, binding };
}

/** One entity id: a picker, plus the id itself so a hand-typed one survives. */
export function EntityRefField({
  entities,
  field,
  preset,
  onChange,
}: {
  entities: readonly EntityOption[];
  field: ControlModuleField;
  preset: ControlPreset;
  onChange: (preset: ControlPreset) => void;
}) {
  const value = String((preset.binding as Record<string, unknown>)[field.id] ?? "");
  const options = entityOptions(entities, field.candidates);
  const known = options.some((option) => option.value === value);
  return (
    <div className="grid gap-2">
      <ConfigSelect
        label={field.label}
        options={[
          { detail: "Let the room decide which unit this is", label: "Not bound — find it in the room", value: "" },
          ...(value && !known ? [{ detail: value, label: `${value} (not in the registry)`, value }] : []),
          ...options,
        ]}
        value={value}
        onChange={(next) => {
          const binding = { ...preset.binding } as Record<string, unknown>;
          if (next === "") delete binding[field.id];
          else binding[field.id] = next;
          onChange({ ...preset, binding });
        }}
      />
      <p className="device-field-detail">{field.detail}</p>
    </div>
  );
}

/** An ordered list of entity ids: chips, an add picker, and a remove on each. */
export function EntityListField({
  entities,
  field,
  preset,
  onChange,
}: {
  entities: readonly EntityOption[];
  field: ControlModuleField;
  preset: ControlPreset;
  onChange: (preset: ControlPreset) => void;
}) {
  const ids = listValue(preset, field.id);
  const options = [
    { detail: "", label: "Choose an entity…", value: "" },
    ...entityOptions(entities, field.candidates).filter((option) => !ids.includes(option.value)),
  ];
  return (
    <div className="grid gap-2">
      <p className="device-field-label">
        {field.label}
        {field.required ? <span className="device-field-required">required</span> : null}
      </p>
      {ids.length ? (
        <ol className="device-field-list">
          {ids.map((id, index) => (
            <li key={id}>
              <span className="device-field-index">{index + 1}</span>
              <span className="device-field-id">{id}</span>
              <MomentaryFeedbackButton
                type="button"
                className="icon-link"
                aria-label={`Remove ${id}`}
                onClick={() => onChange(writeList(preset, field.id, ids.filter((candidate) => candidate !== id)))}
              >
                <X className="h-4 w-4" />
              </MomentaryFeedbackButton>
            </li>
          ))}
        </ol>
      ) : (
        <p className="device-field-empty">Nothing bound yet.</p>
      )}
      <ConfigSelect
        label={`Add ${field.label.toLowerCase()}`}
        options={options}
        value=""
        onChange={(id) => {
          if (id) {
            onChange(writeList(preset, field.id, [...ids, id]));
          }
        }}
      />
      <p className="device-field-detail">{field.detail}</p>
    </div>
  );
}
