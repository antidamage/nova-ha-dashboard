"use client";

/**
 * One instance of the climate command state per room, shared by every control
 * that drives it.
 *
 * The full climate cards and the compact Quick Access segments are on screen at
 * the same time whenever the Climate zone is open. With a hook instance each,
 * their local state did not agree: the press-intent hold that keeps a pressed
 * button lit until the controller catches up only existed in the component that
 * was pressed, the two 2-second setpoint debounces could overwrite each other
 * from stale bases, and — worst — the heater's `modeSaveSequence`
 * last-request-wins guard was per-component, so an Auto here and an Off there
 * resolved by whichever HTTP response landed last rather than by which the user
 * pressed last. That is the failure specs/bedroom-heater-control-integrity.md
 * exists to close, so it must not come back at the component boundary.
 *
 * Consumers call `useSharedAirconCommands` / `useSharedBedroomHeaterCommands`,
 * which use the provider's instance when there is one and fall back to their own
 * (the Plain design mounts the cards without a provider).
 */
import { createContext, useContext, type ReactNode } from "react";
import type { AirconPreferences, BedroomHeaterPreferences, ClimateControlRoomState, DashboardEntity } from "../../../lib/types";
import {
  useAirconCommands,
  useBedroomHeaterCommands,
  type EntityActionsHandler,
} from "./climateCommands";

export type AirconCommands = ReturnType<typeof useAirconCommands>;
export type BedroomHeaterCommands = ReturnType<typeof useBedroomHeaterCommands>;

type ClimateCommandsValue = {
  aircon: AirconCommands;
  heater: BedroomHeaterCommands;
};

const ClimateCommandsContext = createContext<ClimateCommandsValue | null>(null);

export type AirconCommandsInput = {
  controlState?: ClimateControlRoomState;
  entity?: DashboardEntity;
  freshAirSwitch?: DashboardEntity;
  preferences?: AirconPreferences;
  quietSwitch?: DashboardEntity;
  turboSwitch?: DashboardEntity;
  onEntityActions: EntityActionsHandler;
};

export type BedroomHeaterCommandsInput = {
  onNotice?: (message: string) => void;
  preferences?: BedroomHeaterPreferences;
};

export function ClimateCommandsProvider({
  aircon,
  children,
  heater,
}: {
  aircon: AirconCommandsInput;
  children: ReactNode;
  heater: BedroomHeaterCommandsInput;
}) {
  const value: ClimateCommandsValue = {
    aircon: useAirconCommands(aircon),
    heater: useBedroomHeaterCommands(heater),
  };

  return <ClimateCommandsContext.Provider value={value}>{children}</ClimateCommandsContext.Provider>;
}

/**
 * The shared aircon commands, or this component's own when no provider is
 * mounted. The fallback hook is always called — hooks cannot be conditional —
 * but when a provider supplies the value the local instance is never read and
 * never commanded, so it holds no intent and arms no timer.
 */
export function useSharedAirconCommands(input: AirconCommandsInput): AirconCommands {
  const own = useAirconCommands(input);
  return useContext(ClimateCommandsContext)?.aircon ?? own;
}

export function useSharedBedroomHeaterCommands(input: BedroomHeaterCommandsInput): BedroomHeaterCommands {
  const own = useBedroomHeaterCommands(input);
  return useContext(ClimateCommandsContext)?.heater ?? own;
}
