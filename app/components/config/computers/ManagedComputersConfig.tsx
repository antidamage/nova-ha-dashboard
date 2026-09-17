"use client";

import { MonitorSmartphone, Plus, UploadCloud } from "lucide-react";
import { ConfigAccordion } from "../../ConfigControls";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { ComputerCard } from "./ComputerCard";
import { newComputer } from "./computer-model";
import { useManagedComputers } from "./useManagedComputers";

export function ManagedComputersConfig() {
  const {
    applyNow,
    busy,
    computers,
    computersRef,
    message,
    persist,
    replaceComputers,
    update,
    updateAndPersist,
  } = useManagedComputers();

  return (
    <ConfigAccordion
      id="managed-computers"
      title="Managed Computers"
      icon={<MonitorSmartphone className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
      actions={(
        <>
          <MomentaryFeedbackButton type="button" className="icon-link" aria-label="Apply desktop wallpapers" disabled={busy} onClick={applyNow}>
            <UploadCloud className="h-5 w-5" />
          </MomentaryFeedbackButton>
        </>
      )}
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <div className="grid gap-3">
        {computers.map((computer, index) => (
          <ComputerCard
            key={index}
            computer={computer}
            computersRef={computersRef}
            index={index}
            persist={persist}
            replaceComputers={replaceComputers}
            update={update}
            updateAndPersist={updateAndPersist}
          />
        ))}

        <MomentaryFeedbackButton
          type="button"
          className="config-page-button justify-center"
          onClick={() => {
            replaceComputers([...computersRef.current, newComputer()]);
            persist();
          }}
        >
          <Plus className="h-5 w-5" />
          Add Computer
        </MomentaryFeedbackButton>

        {message ? <p className="text-sm font-semibold text-neutral-300">{message}</p> : null}
      </div>
    </ConfigAccordion>
  );
}
