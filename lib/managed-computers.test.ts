import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

async function importWithTempStore(storeValue: unknown) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nova-managed-computers-"));
  const storePath = path.join(tempDir, "managed-computers.json");
  await writeFile(storePath, `${JSON.stringify(storeValue, null, 2)}\n`, "utf8");
  vi.stubEnv("NOVA_MANAGED_COMPUTERS_PATH", storePath);
  vi.stubEnv("NOVA_MANAGED_COMPUTER_KEY_DIR", path.join(tempDir, "keys"));
  vi.stubEnv("NOVA_MANAGED_COMPUTER_KNOWN_HOSTS_DIR", path.join(tempDir, "known-hosts"));
  vi.resetModules();
  return {
    mod: await import("./managed-computers"),
    tempDir,
  };
}

describe("managed computers", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("does not expose password fields and preserves configured capabilities", async () => {
    const { mod, tempDir } = await importWithTempStore({
      version: 1,
      computers: [
        {
          id: "studio-desktop",
          name: "Studio Desktop",
          address: "desktop.local",
          username: "desktop",
          password: "do-not-keep",
          platform: "kde-linux",
          orientation: "landscape",
          enabled: true,
          hostKey: "desktop.local ssh-ed25519 AAAA",
          sshKeyPath: path.join(os.tmpdir(), "missing-key"),
          capabilities: { wallpaper: true, sleep: true, wake: true },
        },
      ],
    });

    try {
      const computers = await mod.listManagedComputers();
      expect(computers[0].capabilities).toEqual({
        // Absent in the stored record: lock screen defaults on, like wallpaper.
        lockScreen: true,
        sleep: true,
        wake: true,
        wallpaper: true,
        voiceSatellite: false,
      });
      expect(JSON.stringify(computers)).not.toContain("do-not-keep");
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("uses fixed wallpaper and sleep commands", async () => {
    const { mod, tempDir } = await importWithTempStore({ version: 1, computers: [] });
    try {
      const fileName = mod.remoteWallpaperFileName("wallpaper_00000000-0000-0000-0000-000000000000", "image/jpeg");
      const decodeWindowsCommand = (command: string) => {
        const encoded = command.split("-EncodedCommand ")[1];
        return Buffer.from(encoded, "base64").toString("utf16le");
      };
      expect(fileName).toBe("nova-wallpaper-00000000-0000-0000-0000-000000000000.jpg");
      expect(decodeWindowsCommand(mod.remoteWallpaperCommand("windows", fileName))).toContain("SystemParametersInfo");
      expect(decodeWindowsCommand(mod.remoteWallpaperCommand("windows", fileName))).toContain("schtasks.exe");
      expect(mod.remoteWallpaperCommand("macos", fileName)).toContain("com.apple.wallpaper");
      expect(mod.remoteWallpaperCommand("kde-linux", fileName)).toContain("preserveAspectCrop");
      expect(() => mod.remoteWallpaperCommand("kde-linux", "bad;name.png")).toThrow(/unsafe/i);
      const lockScreen = decodeWindowsCommand(mod.remoteLockScreenCommand("windows", fileName));
      expect(lockScreen).toContain("PersonalizationCSP");
      expect(lockScreen).toContain("LockScreenImageStatus");
      expect(lockScreen).toContain("DisableLogonBackgroundImage");
      expect(lockScreen).toContain("C:\\ProgramData\\NovaManagedDesktop");
      expect(lockScreen).toContain("IsInRole");
      expect(() => mod.remoteLockScreenCommand("macos", fileName)).toThrow(/only supported on Windows/i);
      expect(() => mod.remoteLockScreenCommand("windows", "bad;name.png")).toThrow(/unsafe/i);
      expect(decodeWindowsCommand(mod.remoteSleepCommand("windows"))).toContain("SetSuspendState");
      expect(mod.remoteSleepCommand("macos")).toBe("pmset sleepnow");
      expect(() => mod.remoteSleepCommand("kde-linux")).toThrow(/not supported/i);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("generates an SSH key pair while saving entries", async () => {
    const { mod, tempDir } = await importWithTempStore({ version: 1, computers: [] });
    try {
      const computers = await mod.saveManagedComputers({
        computers: [
          {
            id: "studio-desktop",
            name: "Studio Desktop",
            address: "desktop.local",
            username: "desktop",
            platform: "macos",
            orientation: "landscape",
            enabled: true,
            hostKey: "SHA256:example",
            capabilities: { wallpaper: true, sleep: true },
          },
        ],
      });

      expect(computers[0].sshKeyConfigured).toBe(true);
      expect(computers[0].sshPublicKey).toMatch(/^ssh-ed25519 /);
      const { utils } = await import("ssh2");
      expect(utils.parseKey(await readFile(computers[0].sshKeyPath, "utf8"))).not.toBeInstanceOf(Error);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("builds a 102-byte wake-on-LAN magic packet and rejects bad MACs", async () => {
    const { mod, tempDir } = await importWithTempStore({ version: 1, computers: [] });
    try {
      const packet = mod.buildWakeOnLanPacket("aa-bb-cc-dd-ee-ff");
      expect(packet.length).toBe(102);
      expect(packet.subarray(0, 6).equals(Buffer.from("ffffffffffff", "hex"))).toBe(true);
      expect(packet.subarray(6, 12).equals(Buffer.from("aabbccddeeff", "hex"))).toBe(true);
      expect(packet.subarray(96, 102).equals(Buffer.from("aabbccddeeff", "hex"))).toBe(true);
      expect(() => mod.buildWakeOnLanPacket("nope")).toThrow(/invalid mac/i);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("normalises the MAC address and preserves configured wake capability", async () => {
    const { mod, tempDir } = await importWithTempStore({ version: 1, computers: [] });
    try {
      const computers = await mod.saveManagedComputers({
        computers: [
          {
            id: "studio-desktop",
            name: "Studio Desktop",
            address: "desktop.local",
            username: "desktop",
            platform: "macos",
            orientation: "landscape",
            enabled: true,
            hostKey: "SHA256:example",
            macAddress: "aabb.ccdd.eeff",
            capabilities: { wallpaper: true, sleep: true, wake: true },
          },
        ],
      });
      const desktop = computers.find((computer) => computer.id === "studio-desktop");
      expect(desktop?.macAddress).toBe("AA:BB:CC:DD:EE:FF");
      expect(desktop?.capabilities.wake).toBe(true);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });

  it("refuses to wake a computer that is not configured for wake", async () => {
    const { mod, tempDir } = await importWithTempStore({
      version: 1,
      computers: [
        {
          id: "studio-desktop",
          name: "Studio Desktop",
          address: "desktop.local",
          username: "desktop",
          platform: "macos",
          orientation: "landscape",
          enabled: true,
          hostKey: "SHA256:example",
          capabilities: { wallpaper: true, sleep: true, wake: false },
        },
      ],
    });
    try {
      await expect(mod.wakeManagedComputer("studio-desktop")).rejects.toThrow(/not configured for wake/i);
    } finally {
      await rm(tempDir, { force: true, recursive: true });
    }
  });
});
