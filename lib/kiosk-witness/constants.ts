import type { KioskIdentity, WitnessState } from "./types";

export const EMPTY_STATE: WitnessState = { open: null, recent: [] };

export const NO_IDENTITY: KioskIdentity = {
  person: null,
  score: null,
  sessionId: null,
  identifiedAt: null,
  ageSeconds: null,
};
