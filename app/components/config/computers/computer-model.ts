// The blank record the Add Computer button appends.

import type { ManagedComputerFormValue } from "../../managed-computers-client";

export function newComputer(): ManagedComputerFormValue {
  const now = new Date().toISOString();
  return {
    address: "",
    capabilities: { lockScreen: true, sleep: false, wake: false, wallpaper: true, voiceSatellite: false },
    commandTimeoutMs: 15000,
    enabled: true,
    hostKey: "",
    id: `computer_${Date.now().toString(36)}`,
    macAddress: "",
    name: "New Computer",
    orientation: "landscape",
    platform: "windows",
    roomId: "",
    sshKeyConfigured: false,
    sshKeyPath: "",
    sshPublicKey: null,
    updatedAt: now,
    username: "",
  };
}
