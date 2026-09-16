/**
 * Managed computers (SSH-controlled desktops) — facade. The body lives in
 * lib/managed-computers/; this file keeps the import path stable for its
 * callers (specs/agent-token-footprint.md §3.3).
 *
 *   managed-computers/types.ts             computer, capability and result shapes
 *   managed-computers/constants.ts         timeout bounds, store and key paths
 *   managed-computers/computer-model.ts    record normalisation
 *   managed-computers/store.ts             SOLE owner of state and disk: write
 *                                          queue, JSON store, SSH key pairs
 *   managed-computers/remote-commands.ts   PowerShell wrapper, wallpaper, sleep
 *   managed-computers/windows-commands.ts  lock screen, Terminal refresh
 *   managed-computers/ssh.ts               host-key pinning, exec, SFTP
 *   managed-computers/power.ts             sleep and Wake-on-LAN
 */
export type {
  CommandResult,
  ManagedComputer,
  ManagedComputerCapabilities,
  ManagedComputerOrientation,
  ManagedComputerPlatform,
  ManagedComputerPublic,
} from "./managed-computers/types";
export { normalizedRoomId } from "./managed-computers/computer-model";
export {
  getManagedComputer,
  listManagedComputers,
  saveManagedComputers,
  setManagedComputerRoom,
} from "./managed-computers/store";
export {
  remotePrepareCommand,
  remoteSleepCommand,
  remoteWallpaperCommand,
  remoteWallpaperFileName,
  windowsPowerShellCommand,
} from "./managed-computers/remote-commands";
export { remoteLockScreenCommand, remoteTerminalRefreshCommand } from "./managed-computers/windows-commands";
export { copyFileToManagedComputer, runManagedComputerSsh } from "./managed-computers/ssh";
export { buildWakeOnLanPacket, sleepManagedComputer, wakeManagedComputer } from "./managed-computers/power";
