import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { voiceSatelliteRestartCommand } from "./voice-satellite-reconnect";

/**
 * NPT-807. The companion device must never be reachable through the
 * managed-computer abstraction.
 *
 * That abstraction restarts things by opening an SSH session to a host. A
 * phone has no SSH server, so a dashboard action built on it could only ever
 * fail — but it would fail *slowly*, after a connection timeout, while telling
 * the owner it was restarting something. The right answer for a phone is
 * "open the app", because on this provisioning path there is genuinely no
 * remote wake.
 *
 * These are regression guards rather than behaviour tests: the property holds
 * today by construction, and the risk is a future change quietly adding an
 * `ios` platform because the abstraction is convenient.
 */
describe("the companion is not a managed computer", () => {
  const source = readFileSync(
    path.join(__dirname, "managed-computers.ts"),
    "utf8",
  );

  it("has no iOS platform to describe a phone with", () => {
    const union = source.match(/export type ManagedComputerPlatform = ([^;]+);/);

    expect(union).not.toBeNull();
    expect(union?.[1]).toBe('"windows" | "macos" | "kde-linux"');
    expect(union?.[1]).not.toMatch(/ios|iphone|ipados/i);
  });

  it("does not know what a companion is", () => {
    // If this ever fails, someone has joined the two surfaces and the
    // reasoning above needs revisiting rather than the test relaxing.
    expect(source.toLowerCase()).not.toContain("companion");
  });

  it("restarts satellites through a supervisor, which a phone does not have", () => {
    // Both commands drive a service manager on a desktop OS. Neither has any
    // meaning on iOS, which is the point: there is nothing here to aim at a
    // phone even if someone tried.
    expect(voiceSatelliteRestartCommand("macos")).toContain("launchctl");
    expect(voiceSatelliteRestartCommand("kde-linux")).toContain("systemctl");
  });

  it("offers no restart or wake action for the companion at all", () => {
    // The companion surface is read-only by design. Its recovery path is a
    // Shortcut on the device itself, which is the only thing that can actually
    // bring a suspended app back.
    const card = readFileSync(
      path.join(__dirname, "..", "app", "components", "CompanionStatusCard.tsx"),
      "utf8",
    );

    // Asserted on what the card can *do*, not on the words it uses — it has
    // to be able to say "there is no remote wake" without tripping its own
    // guard. A read-only card issues no write request and names no transport.
    expect(card).not.toMatch(/\bssh\b/i);
    expect(card).not.toMatch(/method:\s*["'](POST|PUT|PATCH|DELETE)["']/);
    expect(card).toContain("open the companion app on the device");
  });
});
