"use client";

import { Users } from "lucide-react";
import { useCallback, useState } from "react";
import type { HouseholdPerson } from "../../../../lib/config-schema";
import type { ArrivalState } from "../../../../lib/config-schema/arrivals";
import { ConfigAccordion } from "../../ConfigControls";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import {
  addMember,
  addState,
  removeMember,
  removeState,
  renameMember,
  setMemberColor,
  setPrimaryMember,
  targetsWithoutPresets,
  updateState,
} from "./arrival-config-model";
import { MemberEditor } from "./MemberEditor";
import { NEW_PERSON_LABEL, useArrivalSettings } from "./useArrivalSettings";

/**
 * Household members (specs/arrival-and-departure.md): who lives here, what colour
 * they are shown in, and what each of them sets on the way in and on the way out.
 * It sits under Voice &
 * People → User Data because its members ARE the household people that section
 * is about — the same list the voice identities and consumption attribution use.
 */
export function ArrivalConfig() {
  const { data, error, loading, save } = useArrivalSettings();
  const [pending, setPending] = useState<HouseholdPerson[] | null>(null);
  const members = pending ?? data.members;

  /**
   * Optimistic: the tap lands on the new list immediately, then the server's own
   * answer replaces it (or the error stays on screen and the previous list comes
   * back, because `save` leaves `data` alone when it fails).
   */
  const commit = useCallback(
    async (next: HouseholdPerson[]) => {
      // An edit that changed nothing writes nothing: the model refuses a few
      // edits by returning the list it was given, and a config write for the
      // same document is a file rewrite with nothing behind it.
      if (JSON.stringify(next) === JSON.stringify(members)) return;
      setPending(next);
      await save(next);
      setPending(null);
    },
    [members, save],
  );

  const missingPresets = targetsWithoutPresets(data.targets, data.presets);

  return (
    <ConfigAccordion
      id="arrival"
      title="Household members"
      icon={<Users className="config-accordion-icon h-5 w-5" aria-hidden="true" />}
      className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl"
    >
      <div className="grid gap-3">
        <p className="text-sm leading-relaxed text-neutral-400">
          What each household member&apos;s arrival and departure sets. Call{" "}
          <code>/api/arrival/&lt;name&gt;</code> or <code>/api/departure/&lt;name&gt;</code> — the name is the
          member&apos;s name or their id.
        </p>
        {error ? (
          <p role="status" className="text-sm text-red-300">
            {error}
          </p>
        ) : null}
        {loading ? <p className="text-sm text-neutral-500">Loading…</p> : null}
        {!loading && members.length === 0 ? (
          <p className="text-sm text-neutral-500">
            No household people are configured yet. Add the first one below.
          </p>
        ) : null}

        {members.map((member) => (
          <MemberEditor
            key={member.id}
            member={member}
            onColor={(color) => void commit(setMemberColor(members, member.id, color))}
            onPrimary={() => void commit(setPrimaryMember(members, member.id))}
            removable={members.length > 1}
            onRemove={() => void commit(removeMember(members, member.id))}
            onRename={(label) => void commit(renameMember(members, member.id, label))}
            onStateAdd={(event, state: ArrivalState) => void commit(addState(members, member.id, event, state))}
            onStateRemove={(event, index) => void commit(removeState(members, member.id, event, index))}
            onStateUpdate={(event, index, state) => void commit(updateState(members, member.id, event, index, state))}
            presets={data.presets}
            targets={data.targets}
          />
        ))}

        <MomentaryFeedbackButton
          aria-label="Add person"
          onClick={() => void commit(addMember(members, NEW_PERSON_LABEL))}
        >
          Add person
        </MomentaryFeedbackButton>

        {missingPresets.map((target) => (
          <p key={target.kind} className="text-sm text-neutral-500">
            No {target.label.toLowerCase()} presets are defined yet — the target is ready, but nothing can be
            selected for it until one exists.
          </p>
        ))}
      </div>
    </ConfigAccordion>
  );
}
