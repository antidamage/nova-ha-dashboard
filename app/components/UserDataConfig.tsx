"use client";

import { Users } from "lucide-react";
import { ConfigAccordion } from "./ConfigControls";
import { FaceEnrolmentConfig } from "./FaceEnrolmentConfig";
import { KioskActivityConfig } from "./KioskActivityConfig";
import { SpeakerProfilesConfig } from "./SpeakerProfilesConfig";

// Household people and the identities recognized against them. Kept as its own
// section, separate from Voice Infrastructure, because this is data about
// people rather than pipeline/hardware tuning. Face enrolment sits beside the
// voice profiles for the same reason — it is the visual twin of the same thing.
// Wall-panel activity sits here too: it is a record of which of those enrolled
// people did what, so it belongs with the identities rather than in a systems
// section.
export function UserDataConfig() {
  return (
    <ConfigAccordion
      id="user-data"
      title="User Data"
      icon={<Users className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="panel-corner panel-corner-left" />
      <div className="panel-corner panel-corner-right" />
      <SpeakerProfilesConfig />
      <FaceEnrolmentConfig />
      <KioskActivityConfig />
    </ConfigAccordion>
  );
}
