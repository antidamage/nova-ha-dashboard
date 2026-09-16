// Managed-computer shapes. Types only.

export type ManagedComputerPlatform = "windows" | "macos" | "kde-linux";
export type ManagedComputerOrientation = "landscape" | "portrait";

export type ManagedComputerCapabilities = {
  // Windows only: the wallpaper push also replaces the lock/sign-in screen
  // image. Needs an administrator SSH session, since it writes HKLM.
  lockScreen: boolean;
  sleep: boolean;
  wake: boolean;
  wallpaper: boolean;
  voiceSatellite: boolean;
};

export type ManagedComputer = {
  address: string;
  capabilities: ManagedComputerCapabilities;
  commandTimeoutMs: number;
  enabled: boolean;
  hostKey: string;
  id: string;
  macAddress: string;
  name: string;
  orientation: ManagedComputerOrientation;
  platform: ManagedComputerPlatform;
  port?: number;
  // The HA area id this voice satellite is grouped under. Empty means
  // unassigned. Meaningless for computers without the voiceSatellite
  // capability, but kept unconditional to match every other plain field here.
  roomId: string;
  sshKeyPath: string;
  updatedAt: string;
  username: string;
};

export type ManagedComputerPublic = ManagedComputer & {
  sshKeyConfigured: boolean;
  sshPublicKey: string | null;
};

export type ManagedComputerStore = {
  computers: ManagedComputer[];
  version: 1;
};

export type CommandResult = {
  stderr: string;
  stdout: string;
};
