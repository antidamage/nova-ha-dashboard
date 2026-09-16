"use client";

import type { RefObject } from "react";
import type { OrbInfoDisplay } from "../../../../lib/orb-info/types";
import { useOrbDial } from "../../orb-info/useOrbDial";
import { useOrbInfo } from "../../orb-info/useOrbInfo";

export function useOrbInfoDial({
  hidden,
  orbOptedOut,
  forceVisible,
  speechOnly,
  orbInfoModuleId,
  orbInfoDisplay,
  hostRef,
}: {
  hidden: boolean;
  orbOptedOut: boolean;
  forceVisible: boolean;
  speechOnly: boolean;
  orbInfoModuleId?: string;
  orbInfoDisplay?: OrbInfoDisplay;
  hostRef: RefObject<HTMLDivElement | null>;
}) {
  // The readout is a selectable "status orb info module" (lib/orb-info): the orb
  // asks the module for its output and renders whatever the module's display
  // config formats it into. It knows nothing about gyms, CPUs or thermometers.
  const orbInfo = useOrbInfo({
    enabled: !hidden && !orbOptedOut,
    moduleIdOverride: orbInfoModuleId,
    displayOverride: orbInfoDisplay,
  });
  // The dial (tap to open, drag to step) only exists on the live orb, never on
  // previews or the transient speaking orb. Orb push-to-talk is removed.
  const dialEnabled = !forceVisible && !speechOnly && !hidden && !orbInfo.empty && orbInfo.stack.length > 0;
  const dial = useOrbDial({
    enabled: dialEnabled,
    ids: orbInfo.stack.map((item) => item.entry.id),
    hostRef,
    shownAlerting: (id) => {
      const item = orbInfo.stack.find((candidate) => candidate.entry.id === id);
      return Boolean(item?.alert && item.output.dismiss);
    },
    dismiss: (id) => {
      const item = orbInfo.stack.find((candidate) => candidate.entry.id === id);
      if (item?.output.dismiss) void orbInfo.dismissTarget(item.output).catch(console.error);
    },
  });
  const shownItem = orbInfo.stack[dial.index] ?? orbInfo.stack[0];
  return { orbInfo, dialEnabled, dial, shownItem };
}
