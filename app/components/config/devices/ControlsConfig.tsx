"use client";

import { Blocks, Cpu, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { ConfigAccordion } from "../../ConfigControls";
import { ConfirmDialog } from "../../ConfirmDialog";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import type { ControlModule, ControlPreset } from "../../../../lib/control-modules/types";
import { DeviceTypeGroup } from "./DeviceTypeGroup";
import { PresetEditor } from "./PresetEditor";
import { PresetRow } from "./PresetRow";
import { QuickAccessSlots } from "./QuickAccessSlots";
import { behaviourRows, presetFacts } from "./device-model";
import { useControlModules } from "./useControlModules";

/**
 * Devices → Controls & Devices (specs/control-modules.md).
 *
 * A list of device types, each with its own saved presets beneath it — collapsed
 * until opened, and a preset is a tappable row that opens its editor. The Quick
 * Access panel at the top is the other half of the same idea: a preset is a
 * device you have configured, a slot is where the dashboard shows it.
 *
 * A driver type lists the presets running on it as a reverse index, so "what is
 * the Gree unit actually driving?" is answerable without opening anything.
 */
function moduleIcon(module: ControlModule) {
  return module.layer === "driver"
    ? <Cpu className="config-accordion-icon h-5 w-5" aria-hidden="true" />
    : <Blocks className="config-accordion-icon h-5 w-5" aria-hidden="true" />;
}

export function ControlsConfig() {
  const {
    addPreset,
    adoptDerived,
    controls,
    derived,
    entities,
    message,
    modules,
    moveSlot,
    placePreset,
    problems,
    removePreset,
    rooms,
    unplacePreset,
    updatePreset,
  } = useControlModules();
  const [openPresetId, setOpenPresetId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<ControlPreset | null>(null);

  const openPreset = openPresetId ? controls.presets.find((preset) => preset.id === openPresetId) ?? null : null;
  const factsFor = (preset: ControlPreset) => presetFacts(preset, modules, rooms, controls, problems);
  const presetsFor = (module: ControlModule) =>
    module.layer === "driver"
      ? controls.presets.filter((preset) => preset.driverId === module.id)
      : controls.presets.filter((preset) => preset.moduleId === module.id);
  const warnings = problems.filter((problem) => problem.severity === "warning").length;

  const presetList = (module: ControlModule) => {
    const presets = presetsFor(module);
    return (
      <div className="device-type-body">
        <p className="device-type-detail">{module.detail}</p>
        {module.behaviours.length ? (
          <div className="flex flex-wrap gap-2">
            {behaviourRows(module).map((behaviour) => (
              <span className="preset-chip" key={behaviour.id} title={behaviour.detail}>
                {behaviour.label}
              </span>
            ))}
          </div>
        ) : null}
        {presets.length ? (
          <ul className="preset-list">
            {presets.map((preset) => (
              <li key={`${module.id}-${preset.id}`}>
                <PresetRow facts={factsFor(preset)} preset={preset} onOpen={() => setOpenPresetId(preset.id)} />
              </li>
            ))}
          </ul>
        ) : (
          <p className="device-type-empty">
            {module.layer === "driver" ? "No preset is running on this driver yet." : "No preset yet."}
          </p>
        )}
        {module.placeable ? (
          <MomentaryFeedbackButton
            type="button"
            className="config-page-button justify-center"
            onClick={() => {
              const id = addPreset(module.id);
              if (id) setOpenPresetId(id);
            }}
          >
            <Plus className="h-5 w-5" /> Add preset
          </MomentaryFeedbackButton>
        ) : null}
      </div>
    );
  };

  return (
    <ConfigAccordion
      id="controls"
      title="Controls & Devices"
      icon={<Blocks className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <div className="grid gap-4">
        <p className="device-intro">
          Every control on the dashboard is a module with a saved preset: what it is, which room it serves and what it
          drives. Choose a device type below, add a preset under it, then put that preset on Quick Access.
        </p>

        {derived ? (
          <div className="device-derived">
            <Sparkles className="h-5 w-5 shrink-0" aria-hidden="true" />
            <p>
              These presets are read from your existing configuration. Nothing is stored yet, so the dashboard derives
              them every load. Save them to make them yours to edit.
            </p>
            <MomentaryFeedbackButton type="button" className="config-page-button" onClick={adoptDerived}>
              Save these as presets
            </MomentaryFeedbackButton>
          </div>
        ) : null}

        <QuickAccessSlots controls={controls} rooms={rooms} onAdd={placePreset} onMove={moveSlot} onRemove={unplacePreset} />

        {warnings ? <p className="device-warning">{warnings} preset{warnings === 1 ? "" : "s"} still missing a device binding.</p> : null}

        <div className="device-type-list">
          {modules.map((module) => {
            const count = presetsFor(module).length;
            return (
              <DeviceTypeGroup
                badge={`${count} preset${count === 1 ? "" : "s"}`}
                detail={module.summary}
                icon={moduleIcon(module)}
                id={`device-type-${module.id}`}
                key={module.id}
                meta={module.layer === "driver" ? "Driver" : module.category}
                title={module.name}
              >
                {presetList(module)}
              </DeviceTypeGroup>
            );
          })}
        </div>

        {message ? <p className="text-sm font-semibold text-neutral-300">{message}</p> : null}
      </div>

      {openPreset ? (
        <PresetEditor
          controls={controls}
          entities={entities}
          facts={factsFor(openPreset)}
          modules={modules}
          preset={openPreset}
          problems={problems}
          rooms={rooms}
          onClose={() => setOpenPresetId(null)}
          onPlace={placePreset}
          onRequestDelete={setPendingDelete}
          onUnplace={unplacePreset}
          onUpdate={updatePreset}
        />
      ) : null}

      <ConfirmDialog
        copy={pendingDelete ? {
          stages: [{
            body: `Its slot on the dashboard goes with it, and any surface showing it stops.`,
            confirmLabel: "Delete preset",
            title: `Delete ${pendingDelete.name}?`,
          }],
        } : null}
        open={pendingDelete !== null}
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) {
            removePreset(pendingDelete.id);
          }
          setPendingDelete(null);
        }}
      />
    </ConfigAccordion>
  );
}
