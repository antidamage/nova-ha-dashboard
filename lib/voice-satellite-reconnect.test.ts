import { describe, expect, it } from "vitest";
import { voiceSatelliteRestartCommand } from "./voice-satellite-reconnect";

describe("voice satellite reconnect", () => {
  it("restarts the macOS LaunchAgent with a bootstrap fallback", () => {
    const command = voiceSatelliteRestartCommand("macos");
    expect(command.startsWith("/bin/sh -c '")).toBe(true);
    expect(command).toContain('launchctl kickstart -k "gui/$(id -u)/nz.co.skull.NovaVoiceSatellite"');
    expect(command).toContain(
      'launchctl bootstrap "gui/$(id -u)" "$HOME/Library/LaunchAgents/nz.co.skull.NovaVoiceSatellite.plist"',
    );
  });

  it("restarts the Linux user service", () => {
    expect(voiceSatelliteRestartCommand("kde-linux")).toBe(
      "/bin/sh -c 'systemctl --user restart nova-voice-satellite.service'",
    );
  });

  it("rejects platforms without a satellite supervisor", () => {
    expect(() => voiceSatelliteRestartCommand("windows")).toThrow(/not supported/);
  });
});
