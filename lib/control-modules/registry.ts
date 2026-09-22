import { builtInModuleIds, CONTROL_MODULES } from "./catalogue";
import { knownBehaviourIds, readInstalledModules } from "./library";
import type { ControlModule } from "./types";

/**
 * The server's module registry: what this build ships plus what has been
 * installed under `data/control-modules/` (specs/control-modules.md).
 *
 * Node-side only, because it reads the disk. The client receives the same list
 * with the dashboard state rather than reading it for itself, so a lookup can
 * never disagree between the two halves of the page.
 *
 * The list is held in a module-level snapshot refreshed at boot and after every
 * install or remove, rather than read per request: a directory read on every
 * dashboard poll would be a syscall to answer a question that changes when
 * somebody presses a button.
 */

let installed: ControlModule[] = [];
let installErrors: string[] = [];

/** Where this process keeps what it last read. Re-read at boot and on install. */
export function setInstalledModules(modules: readonly ControlModule[], errors: readonly string[] = []): void {
  installed = [...modules];
  installErrors = [...errors];
}

export function installedControlModules(): ControlModule[] {
  return installed;
}

export function moduleInstallErrors(): string[] {
  return installErrors;
}

export function allControlModules(): ControlModule[] {
  return [...CONTROL_MODULES, ...installed];
}

/**
 * The validation context a package is checked against. `moduleIds` is the list
 * as it stands, which is what lets one installed module name another.
 */
export function packageContext() {
  return {
    behaviours: knownBehaviourIds(),
    builtInIds: builtInModuleIds(),
    moduleIds: new Set(allControlModules().map((module) => module.id)),
  };
}

/** Re-read the install directory. Called at boot and after an install or remove. */
export async function refreshInstalledModules(): Promise<string[]> {
  const { errors, modules } = await readInstalledModules(packageContext());
  setInstalledModules(modules, errors);
  return errors;
}
