import type { ManagedComputer, ManagedComputerPlatform } from "./managed-computers";
import type { HighlightColor } from "./wallpaper-color";
import { windowsTerminalAction } from "./desktop-theme-actions/windows-terminal";

/**
 * Per-application theme actions: what a theme change does to the individual
 * *applications* on a managed machine, as opposed to its desktop.
 *
 * The wallpaper push repaints the desktop and the lock screen. This is the
 * layer above that - "Windows Terminal's tab should take the theme's accent",
 * and whatever comes next. Before this existed the one such behaviour (nudging
 * Terminal to reload) was hardcoded inline in `syncComputerWallpaper`, which
 * does not survive a second application being added.
 *
 * **To add an application:** write `lib/desktop-theme-actions/<id>.ts`
 * exporting a `DesktopThemeAction`, and add it to `desktopThemeActions` below.
 * Nothing in `managed-desktop-sync.ts` changes.
 *
 * See `specs/desktop-theme-app-actions.md`.
 */
export type ThemeActionContext = {
  assetId: string;
  computer: ManagedComputer;
  /** Already contrast-clamped: actions paint with it, they do not report it. */
  highlight: HighlightColor;
  remoteFileName: string;
  variant: "dark" | "light";
};

export type DesktopThemeAction = {
  /** Stable - it appears in the persisted applied-state signature. */
  id: string;
  label: string;
  platforms: ManagedComputerPlatform[];
  /**
   * Everything that should make this action re-run. Folded into the sync's
   * change detection, so an action whose inputs changed re-fires even when the
   * wallpaper asset did not.
   */
  signature(context: ThemeActionContext): string;
  run(context: ThemeActionContext): Promise<void>;
};

export const desktopThemeActions: DesktopThemeAction[] = [windowsTerminalAction];

/**
 * Both entry points take the registry as an optional argument rather than
 * closing over it. That keeps the dispatch and signature rules testable
 * against a made-up registry, so their tests do not have to be rewritten every
 * time a real application is added.
 *
 * Sorted by id so the signature does not move when the registry is reordered.
 */
function actionsForPlatform(platform: ManagedComputerPlatform, actions: DesktopThemeAction[]) {
  return actions
    .filter((action) => action.platforms.includes(platform))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function desktopThemeActionSignature(
  context: ThemeActionContext,
  actions: DesktopThemeAction[] = desktopThemeActions,
) {
  return actionsForPlatform(context.computer.platform, actions)
    .map((action) => `${action.id}:${action.signature(context)}`)
    .join("|");
}

/**
 * Run every action that applies to this machine.
 *
 * Each runs in its own try/catch that only logs. This is the existing contract
 * and it is deliberate: an application that failed to repaint must never fail
 * a wallpaper sync that otherwise worked, and one failing action must not stop
 * the next from running.
 */
export async function runDesktopThemeActions(
  context: ThemeActionContext,
  actions: DesktopThemeAction[] = desktopThemeActions,
) {
  for (const action of actionsForPlatform(context.computer.platform, actions)) {
    try {
      await action.run(context);
    } catch (error) {
      console.error("[managed-desktop] theme action failed", action.id, context.computer.id, error);
    }
  }
}
