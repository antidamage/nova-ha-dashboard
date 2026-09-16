"use client";

import type { useOrbDial } from "../../orb-info/useOrbDial";
import type { useOrbInfo } from "../../orb-info/useOrbInfo";
import { OrbStackReadout } from "../../orb-info/OrbEventReadout";

type OrbInfoState = ReturnType<typeof useOrbInfo>;

/** The status orb info readout over the orb face. */
export function OrbInfoCounter({
  forceVisible,
  statusOrbInfoVisible,
  orbInfo,
  speechActive,
  gymCounterStyle,
  shownItem,
  dialEnabled,
  dial,
}: {
  forceVisible: boolean;
  statusOrbInfoVisible: boolean;
  orbInfo: OrbInfoState;
  speechActive: boolean;
  gymCounterStyle: { color: string };
  shownItem: OrbInfoState["stack"][number] | undefined;
  dialEnabled: boolean;
  dial: ReturnType<typeof useOrbDial>;
}) {
  return (
    <>
      {(forceVisible || statusOrbInfoVisible) && !orbInfo.empty ? (
        <div
          className={`nova-avatar-gym-counter${speechActive ? " nova-avatar-gym-counter-speech-hidden" : ""}`}
          style={gymCounterStyle}
          aria-label={shownItem && dialEnabled ? shownItem.ariaLabel : orbInfo.ariaLabel}
          data-nova-orb-info-module={shownItem && dialEnabled ? shownItem.module.id : orbInfo.module.id}
          suppressHydrationWarning
        >
          {dialEnabled && shownItem
            ? <OrbStackReadout item={shownItem} index={dial.index} direction={dial.direction} />
            : <OrbStackReadout item={{ entry: { id: orbInfo.module.id }, output: orbInfo.output, text: orbInfo.text }} index={0} direction={1} />}
        </div>
      ) : null}
    </>
  );
}
