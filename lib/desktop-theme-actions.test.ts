import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { DesktopThemeAction, ThemeActionContext } from "./desktop-theme-actions";

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
});

function context(platform: "kde-linux" | "macos" | "windows" = "windows"): ThemeActionContext {
  return {
    assetId: "wallpaper_00000000-0000-0000-0000-000000000001",
    computer: {
      address: "computer.local",
      capabilities: { lockScreen: true, sleep: false, voiceSatellite: false, wake: false, wallpaper: true },
      commandTimeoutMs: 15_000,
      enabled: true,
      hostKey: "SHA256:test",
      id: "studio-desktop",
      macAddress: null,
      name: "Studio Desktop",
      orientation: "landscape",
      platform,
      roomId: null,
      sshKeyPath: path.join(os.tmpdir(), "nova-test-key"),
      updatedAt: "2026-06-01T00:00:00.000Z",
      username: "desktop",
    } as unknown as ThemeActionContext["computer"],
    highlight: { fallback: false, hex: "#2F5F87", hsl: { h: 207, l: 0.36, s: 0.48 }, rgb: { b: 135, g: 95, r: 47 } },
    remoteFileName: "nova-wallpaper-test.png",
    variant: "dark",
  };
}

function action(overrides: Partial<DesktopThemeAction> & { id: string }): DesktopThemeAction {
  return {
    label: overrides.id,
    platforms: ["windows"],
    run: async () => {},
    signature: () => "sig",
    ...overrides,
  };
}

describe("the shipped registry", () => {
  it("registers Windows Terminal against Windows only", async () => {
    const { desktopThemeActions } = await import("./desktop-theme-actions");
    const terminal = desktopThemeActions.find((entry) => entry.id === "windows-terminal");
    expect(terminal).toBeDefined();
    expect(terminal!.platforms).toEqual(["windows"]);
  });

  it("gives every action a unique id, since ids key the applied-state signature", async () => {
    const { desktopThemeActions } = await import("./desktop-theme-actions");
    const ids = desktopThemeActions.map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("runs nothing on a platform no action targets", async () => {
    const { desktopThemeActionSignature } = await import("./desktop-theme-actions");
    expect(desktopThemeActionSignature(context("macos"))).toBe("");
    expect(desktopThemeActionSignature(context("kde-linux"))).toBe("");
  });
});

describe("runDesktopThemeActions", () => {
  it("runs every action that matches the platform, and no others", async () => {
    const { runDesktopThemeActions } = await import("./desktop-theme-actions");
    const first = vi.fn(async () => {});
    const second = vi.fn(async () => {});
    const wrongPlatform = vi.fn(async () => {});

    await runDesktopThemeActions(context("windows"), [
      action({ id: "a", run: first }),
      action({ id: "b", run: second }),
      action({ id: "c", platforms: ["macos"], run: wrongPlatform }),
    ]);

    expect(first).toHaveBeenCalledOnce();
    expect(second).toHaveBeenCalledOnce();
    expect(wrongPlatform).not.toHaveBeenCalled();
  });

  it("swallows a thrown action and still runs the next one", async () => {
    const { runDesktopThemeActions } = await import("./desktop-theme-actions");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const after = vi.fn(async () => {});

    // The contract: an application that failed to repaint must never fail the
    // wallpaper sync, and must not stop the next application either.
    await expect(
      runDesktopThemeActions(context("windows"), [
        action({ id: "a-explodes", run: async () => { throw new Error("boom"); } }),
        action({ id: "b-survives", run: after }),
      ]),
    ).resolves.toBeUndefined();

    expect(after).toHaveBeenCalledOnce();
    expect(errors).toHaveBeenCalled();
  });
});

describe("desktopThemeActionSignature", () => {
  it("is stable across registry order and includes each action's own signature", async () => {
    const { desktopThemeActionSignature } = await import("./desktop-theme-actions");
    const a = action({ id: "a", signature: () => "1" });
    const b = action({ id: "b", signature: () => "2" });

    expect(desktopThemeActionSignature(context(), [a, b])).toBe("a:1|b:2");
    expect(desktopThemeActionSignature(context(), [b, a])).toBe("a:1|b:2");
  });

  it("moves when an action's signature moves", async () => {
    const { desktopThemeActionSignature } = await import("./desktop-theme-actions");
    let value = "1";
    const actions = [action({ id: "a", signature: () => value })];
    const before = desktopThemeActionSignature(context(), actions);
    value = "2";
    expect(desktopThemeActionSignature(context(), actions)).not.toBe(before);
  });

  it("excludes actions that do not apply to the platform", async () => {
    const { desktopThemeActionSignature } = await import("./desktop-theme-actions");
    const actions = [action({ id: "a" }), action({ id: "b", platforms: ["macos"] })];
    expect(desktopThemeActionSignature(context("windows"), actions)).toBe("a:sig");
    expect(desktopThemeActionSignature(context("macos"), actions)).toBe("b:sig");
  });

  it("tracks the highlight colour for the shipped Windows Terminal action", async () => {
    const { desktopThemeActionSignature } = await import("./desktop-theme-actions");
    const base = context();
    const recoloured = { ...base, highlight: { ...base.highlight, hex: "#FFFFFF" } };
    expect(desktopThemeActionSignature(base)).not.toBe(desktopThemeActionSignature(recoloured));
  });
});
