"use client";

import type { ControlModuleField, ControlPreset } from "../../../../lib/control-modules/types";
import { Field } from "../computers/Field";
import { EntityListField, EntityRefField, type EntityOption } from "./EntityFields";
import { fieldText, placeText } from "./device-model";

/**
 * A preset's binding fields (specs/control-modules.md).
 *
 * Which fields these are comes from the control plus the assigned driver, and
 * what each one LOOKS like comes from its `kind`: an entity is a picker over the
 * registry, an ordered list is chips (its order is a safety property, so a
 * control that re-sorted it would be re-deciding which reading the thermostat
 * trusts), and a word list or a number is an ordinary single-line field.
 */

function setBinding(preset: ControlPreset, fieldId: string, value: string | number | string[]): ControlPreset {
  const binding = { ...preset.binding } as Record<string, unknown>;
  if (value === "" || (Array.isArray(value) && value.length === 0)) {
    delete binding[fieldId];
  } else {
    binding[fieldId] = value;
  }
  return { ...preset, binding };
}

export function PresetBindingFields({
  entities,
  fields,
  preset,
  onUpdate,
}: {
  entities: readonly EntityOption[];
  fields: readonly ControlModuleField[];
  preset: ControlPreset;
  onUpdate: (preset: ControlPreset) => void;
}) {
  return (
    <div className="grid gap-3 md:grid-cols-2">
      {fields.map((field) =>
        field.kind === "entity" ? (
          <EntityRefField key={field.id} entities={entities} field={field} preset={preset} onChange={onUpdate} />
        ) : field.kind === "entity-list" ? (
          <EntityListField key={field.id} entities={entities} field={field} preset={preset} onChange={onUpdate} />
        ) : (
          <Field
            key={field.id}
            label={field.label}
            value={fieldText(field, preset)}
            onChange={(text) => onUpdate(setBinding(
              preset,
              field.id,
              field.kind === "token-list"
                ? placeText(text, ",")
                : field.kind === "number"
                  ? Number.isFinite(Number(text)) && text !== "" ? Number(text) : ""
                  : text,
            ))}
            onCommit={() => undefined}
          />
        ),
      )}
    </div>
  );
}
