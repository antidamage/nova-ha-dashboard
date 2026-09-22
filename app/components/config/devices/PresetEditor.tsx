"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import { ConfigSelect } from "../../ConfigSelect";
import { ModalOverlay } from "../../ModalOverlay";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { CheckboxRow } from "../../controls/config/CheckboxRow";
import { editorFields, driversFor } from "../../../../lib/control-modules/presets";
import { CONTROL_RENDERERS } from "../../../../lib/control-modules/renderers";
import { ROOM_INHERIT_LABEL, roomLabel } from "../../../../lib/control-modules/rooms";
import type { RoomOption } from "../../../../lib/control-modules/rooms";
import type { ControlModule, ControlPreset, ControlsConfig, PresetProblem } from "../../../../lib/control-modules/types";
import { Field } from "../computers/Field";
import { PresetBindingFields } from "./PresetBindingFields";
import { behaviourRows, featureRows } from "./device-model";
import type { PresetFacts } from "./device-model";
import type { EntityOption } from "./EntityFields";

/**
 * One preset's editor (specs/control-modules.md).
 *
 * Fields are generated from the module, and from the driver once one is chosen:
 * a control contributes what every variant shares, a driver contributes what its
 * hardware needs. Nothing here is a JSON textarea and nothing is a raw control —
 * the shared config inventory is used throughout, so this page cannot drift into
 * looking like a different product.
 *
 * There is no Save button: every change writes the whole list as it is made, the
 * way the rest of the config page autosaves. That is a write per keystroke in a
 * text field, which the preset list is small enough to afford — and `Field`'s
 * `onCommit` is left inert rather than given its own save, so there is exactly
 * one moment a change reaches the server.
 */

export function PresetEditor({
  controls,
  entities,
  facts,
  modules,
  onClose,
  onPlace,
  onRequestDelete,
  onUnplace,
  onUpdate,
  preset,
  problems,
  rooms,
}: {
  controls: ControlsConfig;
  /** What the binding pickers may offer. An id is still free text. */
  entities: readonly EntityOption[];
  facts: PresetFacts;
  modules: readonly ControlModule[];
  onClose: () => void;
  onPlace: (presetId: string) => void;
  onRequestDelete: (preset: ControlPreset) => void;
  onUnplace: (slotId: string) => void;
  onUpdate: (presetId: string, updater: (preset: ControlPreset) => ControlPreset) => void;
  preset: ControlPreset;
  problems: readonly PresetProblem[];
  rooms: readonly RoomOption[];
}) {
  const module = facts.module;
  const driver = facts.driver;
  const fields = module ? editorFields(module, driver) : [];
  const drivers = module ? driversFor(module, preset.variant, modules) : [];
  const slot = controls.slots.find((candidate) => candidate.presetId === preset.id) ?? null;
  const update = (updater: (current: ControlPreset) => ControlPreset) => onUpdate(preset.id, updater);
  const presetProblems = problems.filter((problem) => problem.presetId === preset.id);

  return (
    <ModalOverlay
      ariaLabel={`Edit ${preset.name}`}
      className="device-preset-editor"
      open
      onClose={onClose}
    >
      <div className="grid gap-4">
        <header className="grid gap-1">
          <p className="text-xs font-black uppercase text-cyan-200">{module?.name ?? preset.moduleId}</p>
          <p className="text-sm text-neutral-300">{module?.detail}</p>
        </header>

        <Field
          label="Name"
          value={preset.name}
          onChange={(name) => update((current) => ({ ...current, name }))}
          onCommit={() => undefined}
        />

        <div className="grid gap-3 md:grid-cols-2">
          <ConfigSelect
            label="HA room"
            options={[
              { detail: "Follow the room this control is placed in", label: ROOM_INHERIT_LABEL, value: "" },
              ...rooms.map((room) => ({ detail: room.detail, label: room.name, value: room.id })),
            ]}
            value={preset.roomId ?? ""}
            onChange={(value) => update((current) => ({ ...current, roomId: value === "" ? null : value }))}
          />
          {module && module.variants.length ? (
            <ConfigSelect
              label="This control is"
              options={module.variants.map((variant) => ({ detail: variant.detail, label: variant.label, value: variant.id }))}
              value={preset.variant ?? ""}
              onChange={(variant) => {
                const nextDriver = driversFor(module, variant, modules)[0];
                update((current) => ({ ...current, driverId: nextDriver?.id ?? null, variant }));
              }}
            />
          ) : null}
          {drivers.length ? (
            <ConfigSelect
              label="Runs on"
              options={drivers.map((candidate) => ({
                detail: candidate.behaviours.map((id) => behaviourRows({ ...candidate, behaviours: [id] })[0].label).slice(0, 3).join(", "),
                label: candidate.name,
                value: candidate.id,
              }))}
              value={preset.driverId ?? drivers[0]?.id ?? ""}
              onChange={(driverId) => update((current) => ({ ...current, driverId }))}
            />
          ) : null}
        </div>

        {module && module.renderer ? (
          <p className="device-editor-note">
            Drawn by the {CONTROL_RENDERERS[module.renderer].label.toLowerCase()}. {driver ? `Its behaviour comes from ${driver.name}.` : ""}
          </p>
        ) : null}

        {fields.length ? (
          <PresetBindingFields
            entities={entities}
            fields={fields}
            preset={preset}
            onUpdate={(next) => onUpdate(preset.id, () => next)}
          />
        ) : null}

        {module?.features.length ? (
          <fieldset className="grid gap-2">
            <legend className="text-xs font-black uppercase text-neutral-400">Features</legend>
            {featureRows(module, driver, preset, modules).map((feature) => (
              <CheckboxRow
                key={feature.id}
                checked={feature.available && feature.value}
                detail={feature.detail}
                disabled={!feature.available}
                label={feature.label}
                onChange={(value) => update((current) => ({ ...current, features: { ...current.features, [feature.id]: value } }))}
              />
            ))}
          </fieldset>
        ) : null}

        {module ? (
          <div className="grid gap-2">
            <p className="text-xs font-black uppercase text-neutral-400">
              {module.layer === "driver" ? "Behaviour this driver provides" : "Behaviour this control links into"}
            </p>
            <div className="flex flex-wrap gap-2">
              {behaviourRows(module).map((behaviour) => (
                <span className="preset-chip" key={behaviour.id} title={behaviour.detail}>
                  {behaviour.label}
                </span>
              ))}
            </div>
          </div>
        ) : null}

        {presetProblems.length ? (
          <ul className="grid gap-1 text-sm text-amber-200">
            {presetProblems.map((problem) => (
              <li key={`${problem.field}-${problem.message}`}>{problem.message}</li>
            ))}
          </ul>
        ) : null}

        <footer className="flex flex-wrap items-center gap-2">
          {slot ? (
            <MomentaryFeedbackButton
              type="button"
              className="config-page-button"
              onClick={() => {
                onUnplace(slot.id);
                onClose();
              }}
            >
              Remove from Quick Access
            </MomentaryFeedbackButton>
          ) : (
            <MomentaryFeedbackButton
              type="button"
              className="config-page-button"
              onClick={() => {
                onPlace(preset.id);
                onClose();
              }}
            >
              <Plus className="h-5 w-5" /> Put on Quick Access
            </MomentaryFeedbackButton>
          )}
          <MomentaryFeedbackButton type="button" className="config-page-button" onClick={onClose}>
            <Check className="h-5 w-5" /> Done
          </MomentaryFeedbackButton>
          <MomentaryFeedbackButton
            type="button"
            className="config-page-button device-editor-delete"
            onClick={() => {
              onRequestDelete(preset);
              onClose();
            }}
          >
            <Trash2 className="h-5 w-5" /> Delete
          </MomentaryFeedbackButton>
          <span className="device-editor-footnote">{roomLabel(preset.roomId, rooms)}</span>
        </footer>
      </div>
    </ModalOverlay>
  );
}
