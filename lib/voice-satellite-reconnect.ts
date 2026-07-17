import {
  getManagedComputer,
  listManagedComputers,
  normalizedRoomId,
  runManagedComputerSsh,
  setManagedComputerRoom,
  type ManagedComputerPlatform,
  type ManagedComputerPublic,
} from "./managed-computers";

// A dropped satellite is recovered by restarting its supervisor-managed
// service on the host over SSH — the same procedure used manually. The
// satellite process reconnects to the voice server on its own once relaunched.
// Commands are wrapped in `/bin/sh -c '…'` so they run identically whatever
// login shell the remote account uses (fish does not understand `$(…)`).
const MACOS_LAUNCH_AGENT = "nz.co.skull.NovaVoiceSatellite";
const LINUX_SERVICE = "nova-voice-satellite.service";

export function voiceSatelliteRestartCommand(platform: ManagedComputerPlatform) {
  if (platform === "macos") {
    // kickstart -k kills and relaunches the running agent; if it was booted
    // out entirely (a failed deploy, a manual bootout), fall back to
    // bootstrapping the installed plist.
    return (
      "/bin/sh -c '"
      + `launchctl kickstart -k "gui/$(id -u)/${MACOS_LAUNCH_AGENT}"`
      + ` || { launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/${MACOS_LAUNCH_AGENT}.plist"`
      + ` && launchctl kickstart "gui/$(id -u)/${MACOS_LAUNCH_AGENT}"; }`
      + "'"
    );
  }
  if (platform === "kde-linux") {
    return `/bin/sh -c 'systemctl --user restart ${LINUX_SERVICE}'`;
  }
  throw new Error("Voice satellite restart is not supported for this platform");
}

export async function listVoiceSatelliteComputers(): Promise<ManagedComputerPublic[]> {
  const computers = await listManagedComputers();
  return computers.filter((computer) => computer.capabilities.voiceSatellite);
}

export async function reconnectVoiceSatellite(id: string) {
  const computer = await getManagedComputer(id);
  if (!computer.capabilities.voiceSatellite) {
    throw new Error(`${computer.name} is not configured as a voice satellite`);
  }
  await runManagedComputerSsh(computer, voiceSatelliteRestartCommand(computer.platform));
  return { action: "reconnect" as const, id: computer.id, name: computer.name };
}

// roomId is re-validated here (not just trusted from the caller) because it is
// interpolated directly into a remote shell command below.
const ROOM_ID_SAFE_PATTERN = /^[a-z0-9_-]{1,64}$/;

export function voiceSatelliteSetRoomCommand(platform: ManagedComputerPlatform, roomId: string): string {
  if (!ROOM_ID_SAFE_PATTERN.test(roomId)) {
    throw new Error("Unsafe room id");
  }
  if (platform === "kde-linux") {
    return (
      "/bin/sh -c '"
      + `sed -i "s/^NOVA_VOICE_SATELLITE_ROOM_ID=.*/NOVA_VOICE_SATELLITE_ROOM_ID=${roomId}/" "$HOME/.config/nova-voice/satellite.env"`
      + ` && systemctl --user restart ${LINUX_SERVICE}`
      + "'"
    );
  }
  if (platform === "macos") {
    return (
      "/bin/sh -c '"
      + `/usr/bin/plutil -replace EnvironmentVariables.NOVA_VOICE_ROOM_ID -string "${roomId}" "$HOME/Library/LaunchAgents/${MACOS_LAUNCH_AGENT}.plist"`
      + ` && launchctl kickstart -k "gui/$(id -u)/${MACOS_LAUNCH_AGENT}"`
      + "'"
    );
  }
  throw new Error("Voice satellite room assignment is not supported for this platform");
}

async function pushVoiceSatelliteRoom(id: string, roomId: string) {
  const computer = await getManagedComputer(id);
  if (!computer.capabilities.voiceSatellite) {
    throw new Error(`${computer.name} is not configured as a voice satellite`);
  }
  await runManagedComputerSsh(computer, voiceSatelliteSetRoomCommand(computer.platform, roomId));
}

// Always saves the dashboard-side grouping; only attempts to sync the room
// onto the satellite itself (over SSH, then a supervisor restart to pick it
// up) when an actual room was chosen. Clearing the assignment back to
// "unassigned" is a dashboard-only grouping change — the satellite keeps
// announcing whatever room_id it was last given, since that field can't be
// empty on the satellite side.
export async function assignVoiceSatelliteRoom(id: string, roomId: string) {
  const normalizedRoom = normalizedRoomId(roomId);
  const computer = await setManagedComputerRoom(id, normalizedRoom);
  if (!normalizedRoom) {
    return { computer, pushed: false as const, pushError: undefined };
  }
  try {
    await pushVoiceSatelliteRoom(id, normalizedRoom);
    return { computer, pushed: true as const, pushError: undefined };
  } catch (error) {
    return {
      computer,
      pushed: false as const,
      pushError: error instanceof Error ? error.message : "Saved on the dashboard, but couldn't sync it to the satellite",
    };
  }
}
