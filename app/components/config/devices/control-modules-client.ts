"use client";

import type { ControlModule, ControlsConfig, PresetProblem } from "../../../../lib/control-modules/types";
import type { RoomOption } from "../../../../lib/control-modules/rooms";
import type { EntityOption } from "./EntityFields";

/**
 * The Devices tab's transport (specs/control-modules.md).
 *
 * One read and one whole-list write: the config merge replaces arrays whole, so
 * a partial preset write would leave the client and the server holding different
 * lists — and a preset list is small enough that there is nothing to gain from
 * sending less of it.
 */

export type ControlModulesPayload = {
  controls: ControlsConfig;
  /** True while nothing is stored and the whole set is derived from the config. */
  derived: boolean;
  /** Live entities the binding fields can offer. An id is still free text. */
  entities: EntityOption[];
  /** Installed packages this build refused to load, with their reason. */
  installErrors: string[];
  /** The modules that came from a package rather than from this build. */
  installedIds: string[];
  modules: ControlModule[];
  problems: PresetProblem[];
  rooms: RoomOption[];
};

export type ControlModulesSaveResult = {
  controls: ControlsConfig;
  derived: boolean;
  problems: PresetProblem[];
};

async function readError(response: Response, fallback: string) {
  try {
    const payload = await response.json() as { error?: string };
    return payload.error ?? fallback;
  } catch {
    return fallback;
  }
}

export async function loadControlModules(): Promise<ControlModulesPayload> {
  const response = await fetch("/api/control-modules", { cache: "no-store" });
  if (!response.ok) {
    throw new Error(await readError(response, "Could not read the control configuration"));
  }
  return await response.json() as ControlModulesPayload;
}

export async function saveControlModules(controls: ControlsConfig): Promise<ControlModulesSaveResult> {
  const response = await fetch("/api/control-modules", {
    body: JSON.stringify({ controls }),
    headers: { "Content-Type": "application/json" },
    method: "PUT",
  });
  if (!response.ok) {
    throw new Error(await readError(response, "Could not save the control configuration"));
  }
  return await response.json() as ControlModulesSaveResult;
}
