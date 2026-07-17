import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { createSocket } from "dgram";
import { createHash, randomUUID } from "crypto";
import { Client, utils, type ConnectConfig } from "ssh2";
import { clearComputerSleeping, markComputerSleeping } from "./sleeping-computers";

export type ManagedComputerPlatform = "windows" | "macos" | "kde-linux";
export type ManagedComputerOrientation = "landscape" | "portrait";

export type ManagedComputerCapabilities = {
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

type ManagedComputerStore = {
  computers: ManagedComputer[];
  version: 1;
};

export type CommandResult = {
  stderr: string;
  stdout: string;
};

const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
const MIN_COMMAND_TIMEOUT_MS = 1_000;
const MAX_COMMAND_TIMEOUT_MS = 120_000;
const STORE_PATH =
  process.env.NOVA_MANAGED_COMPUTERS_PATH ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "managed-computers.json");
const KEY_DIR =
  process.env.NOVA_MANAGED_COMPUTER_KEY_DIR ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "managed-computer-keys");
let writeQueue = Promise.resolve();

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizedId(value: unknown, fallback = `computer_${randomUUID()}`) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9_-]{1,63}$/.test(text) ? text : fallback;
}

function normalizedNetworkName(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /\s/.test(text)) {
    return "";
  }
  return text.slice(0, 253);
}

function normalizedPlatform(value: unknown): ManagedComputerPlatform {
  if (value === "windows" || value === "macos" || value === "kde-linux") {
    return value;
  }
  return "windows";
}

function normalizedOrientation(value: unknown): ManagedComputerOrientation {
  return value === "portrait" ? "portrait" : "landscape";
}

// HA area ids are lowercase snake/kebab slugs. Anything else (including the
// empty string) means "unassigned" rather than a validation error, since a
// satellite is perfectly usable before it has been placed in a room.
const ROOM_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

export function normalizedRoomId(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ROOM_ID_PATTERN.test(text) ? text : "";
}

function normalizedTimeout(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  return Math.max(MIN_COMMAND_TIMEOUT_MS, Math.min(MAX_COMMAND_TIMEOUT_MS, Math.round(parsed)));
}

function normalizedPort(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return undefined;
  }
  return parsed;
}

function normalizedCapabilities(value: unknown, id: string): ManagedComputerCapabilities {
  const record = isRecord(value) ? value : {};
  return {
    sleep: record.sleep === true,
    wake: record.wake === true,
    wallpaper: record.wallpaper !== false,
    voiceSatellite: record.voiceSatellite === true,
  };
}

// Accept the usual MAC notations (AA:BB:.., AA-BB-.., aabb.aabb.aabb, bare hex)
// and normalise to upper-case colon form. Anything that is not exactly 12 hex
// digits becomes "" (no MAC = not wakeable).
function normalizedMac(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text) {
    return "";
  }
  const hex = text.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) {
    return "";
  }
  return (hex.match(/.{2}/g) ?? []).join(":").toUpperCase();
}

function defaultKeyPath(id: string) {
  return path.join(KEY_DIR, `${id}_ed25519`);
}

function normalizeComputer(value: unknown): ManagedComputer | null {
  if (!isRecord(value)) {
    return null;
  }
  const id = normalizedId(value.id);
  const name = typeof value.name === "string" && value.name.trim() ? value.name.trim().slice(0, 80) : id;
  const now = new Date().toISOString();
  return {
    address: normalizedNetworkName(value.address),
    capabilities: normalizedCapabilities(value.capabilities, id),
    commandTimeoutMs: normalizedTimeout(value.commandTimeoutMs),
    enabled: value.enabled === true,
    hostKey: typeof value.hostKey === "string" ? value.hostKey.trim() : "",
    id,
    macAddress: normalizedMac(value.macAddress),
    name,
    orientation: normalizedOrientation(value.orientation),
    platform: normalizedPlatform(value.platform),
    port: normalizedPort(value.port),
    roomId: normalizedRoomId(value.roomId),
    sshKeyPath: typeof value.sshKeyPath === "string" && value.sshKeyPath.trim() ? value.sshKeyPath.trim() : defaultKeyPath(id),
    updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : now,
    username: normalizedNetworkName(value.username),
  };
}

async function fileExists(filePath: string) {
  try {
    await readFile(filePath);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

function generateManagedKeyPair(comment: string) {
  const keyPair = utils.generateKeyPairSync("ed25519", { comment });
  return { privateKey: keyPair.private, publicLine: keyPair.public };
}

async function privateKeyIsUsable(filePath: string) {
  try {
    const parsed = utils.parseKey(await readFile(filePath, "utf8"));
    return !(parsed instanceof Error);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function ensureKey(computer: ManagedComputer): Promise<ManagedComputer> {
  if (await privateKeyIsUsable(computer.sshKeyPath)) {
    await chmod(computer.sshKeyPath, 0o600).catch(() => undefined);
    return computer;
  }

  await mkdir(path.dirname(computer.sshKeyPath), { recursive: true });
  const keyPair = generateManagedKeyPair(`nova-managed-${computer.id}`);
  await writeFile(computer.sshKeyPath, keyPair.privateKey, "utf8");
  await writeFile(`${computer.sshKeyPath}.pub`, `${keyPair.publicLine.trim()}\n`, "utf8");
  await chmod(computer.sshKeyPath, 0o600).catch(() => undefined);
  return computer;
}

async function readStore(): Promise<ManagedComputerStore> {
  try {
    const value = JSON.parse(await readFile(STORE_PATH, "utf8")) as unknown;
    const computers = isRecord(value) && Array.isArray(value.computers)
      ? value.computers.map(normalizeComputer).filter((item): item is ManagedComputer => Boolean(item))
      : [];
    return { version: 1, computers };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { version: 1, computers: [] };
    }
    throw error;
  }
}

async function writeStore(store: ManagedComputerStore) {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, STORE_PATH);
  await chmod(STORE_PATH, 0o600).catch(() => undefined);
}

async function publicComputer(computer: ManagedComputer): Promise<ManagedComputerPublic> {
  let sshPublicKey: string | null = null;
  try {
    sshPublicKey = (await readFile(`${computer.sshKeyPath}.pub`, "utf8")).trim() || null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  return {
    ...computer,
    sshKeyConfigured: await fileExists(computer.sshKeyPath),
    sshPublicKey,
  };
}

export async function listManagedComputers(): Promise<ManagedComputerPublic[]> {
  const store = await readStore();
  return Promise.all(store.computers.map(publicComputer));
}

export async function saveManagedComputers(value: unknown): Promise<ManagedComputerPublic[]> {
  const raw = isRecord(value) && Array.isArray(value.computers) ? value.computers : Array.isArray(value) ? value : [];
  const now = new Date().toISOString();
  const seen = new Set<string>();
  const computers: ManagedComputer[] = [];

  for (const rawComputer of raw) {
    const normalized = normalizeComputer(rawComputer);
    if (!normalized || seen.has(normalized.id)) {
      continue;
    }
    seen.add(normalized.id);
    computers.push(await ensureKey({ ...normalized, updatedAt: now }));
  }

  writeQueue = writeQueue.then(() => writeStore({ version: 1, computers }));
  await writeQueue;
  return listManagedComputers();
}

// Patches just the room assignment, leaving SSH keys/timestamps of every
// other computer untouched (unlike saveManagedComputers, which re-normalizes
// the whole submitted list).
export async function setManagedComputerRoom(id: string, roomId: string): Promise<ManagedComputerPublic> {
  const normalized = normalizedId(id, "");
  const store = await readStore();
  const index = store.computers.findIndex((item) => item.id === normalized);
  if (index === -1) {
    throw new Error(`Unknown managed computer: ${id}`);
  }
  const updated: ManagedComputer = {
    ...store.computers[index],
    roomId: normalizedRoomId(roomId),
    updatedAt: new Date().toISOString(),
  };
  const computers = [...store.computers];
  computers[index] = updated;
  writeQueue = writeQueue.then(() => writeStore({ version: 1, computers }));
  await writeQueue;
  return publicComputer(updated);
}

export async function getManagedComputer(id: string) {
  const normalized = normalizedId(id, "");
  const computer = (await readStore()).computers.find((item) => item.id === normalized);
  if (!computer) {
    throw new Error(`Unknown managed computer: ${id}`);
  }
  return computer;
}

function destination(computer: ManagedComputer) {
  if (!computer.address || !computer.username) {
    throw new Error(`${computer.name} is missing an address or username`);
  }
}

function hostFingerprint(key: Buffer) {
  return `SHA256:${createHash("sha256").update(key).digest("base64").replace(/=+$/, "")}`;
}

function knownHostsKeyBlob(line: string) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) {
    return null;
  }
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2) {
    return null;
  }
  const keyPart = parts.find((part) => /^[A-Za-z0-9+/]+={0,2}$/.test(part) && part.length > 40);
  return keyPart ? Buffer.from(keyPart, "base64") : null;
}

function hostKeyMatches(expected: string, key: Buffer) {
  const expectedLines = expected
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const actualFingerprint = hostFingerprint(key);

  return expectedLines.some((line) => {
    if (line.startsWith("SHA256:")) {
      return line.replace(/=+$/, "") === actualFingerprint;
    }
    const keyBlob = knownHostsKeyBlob(line);
    return Boolean(keyBlob && keyBlob.equals(key));
  });
}

async function connectManagedComputer(computer: ManagedComputer): Promise<Client> {
  if (!computer.enabled) {
    throw new Error(`${computer.name} is disabled`);
  }
  if (!computer.hostKey) {
    throw new Error(`${computer.name} is missing an SSH host-key pin`);
  }
  destination(computer);
  const privateKey = await readFile(computer.sshKeyPath, "utf8");
  const client = new Client();
  const config: ConnectConfig = {
    host: computer.address,
    hostVerifier: (key: Buffer) => Buffer.isBuffer(key) && hostKeyMatches(computer.hostKey, key),
    keepaliveInterval: Math.max(5_000, Math.min(computer.commandTimeoutMs, 20_000)),
    port: computer.port ?? 22,
    privateKey,
    readyTimeout: computer.commandTimeoutMs,
    username: computer.username,
  };

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end();
      reject(new Error(`${computer.name} SSH connection timed out after ${computer.commandTimeoutMs}ms`));
    }, computer.commandTimeoutMs);
    client
      .once("ready", () => {
        clearTimeout(timer);
        resolve(client);
      })
      .once("error", (error) => {
        clearTimeout(timer);
        reject(error);
      })
      .connect(config);
  });
}

function assertSafeRemoteFileName(fileName: string) {
  if (!/^nova-wallpaper-[a-z0-9_-]+\.(png|jpg|webp)$/.test(fileName)) {
    throw new Error("Unsafe remote wallpaper file name");
  }
}

function windowsPowerShellCommand(script: string) {
  const wrapped = `$ProgressPreference = 'SilentlyContinue'; ${script}`;
  return `powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${Buffer.from(wrapped, "utf16le").toString("base64")}`;
}

export function remoteWallpaperFileName(assetId: string, contentType: string) {
  const extension = contentType === "image/jpeg" ? "jpg" : contentType === "image/webp" ? "webp" : "png";
  return `nova-wallpaper-${assetId.replace(/^wallpaper_/, "")}.${extension}`;
}

export function remotePrepareCommand(platform: ManagedComputerPlatform) {
  if (platform === "windows") {
    return windowsPowerShellCommand("New-Item -ItemType Directory -Force -Path (Join-Path $HOME 'NovaManagedDesktop') | Out-Null");
  }
  return "mkdir -p \"$HOME/NovaManagedDesktop\"";
}

export function remoteWallpaperCommand(platform: ManagedComputerPlatform, fileName: string) {
  assertSafeRemoteFileName(fileName);
  if (platform === "windows") {
    const childPath = `NovaManagedDesktop\\${fileName}`;
    return windowsPowerShellCommand([
      "$ErrorActionPreference = 'Stop'",
      `$path = Join-Path $HOME '${childPath}'`,
      "$workDir = Join-Path $HOME 'NovaManagedDesktop'",
      "$statusPath = Join-Path $workDir 'wp-status.txt'",
      "$scriptPath = Join-Path $workDir 'wp.ps1'",
      "$cmdPath = Join-Path $workDir 'wp.cmd'",
      "$taskName = 'NovaManagedDesktopWallpaper'",
      "$applyScript = @'\nparam([string]$Path, [string]$StatusPath)\n$ErrorActionPreference = 'Stop'\ntry {\n  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name WallpaperStyle -Value '10'\n  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name TileWallpaper -Value '0'\n  Set-ItemProperty -Path 'HKCU:\\Control Panel\\Desktop' -Name Wallpaper -Value $Path\n  $code = 'using System.Runtime.InteropServices; public class NovaWallpaper { [DllImport(\"user32.dll\", SetLastError=true, CharSet=CharSet.Unicode)] public static extern bool SystemParametersInfo(int a, int b, string c, int d); }'\n  Add-Type $code\n  if (-not [NovaWallpaper]::SystemParametersInfo(20, 0, $Path, 3)) { throw 'SystemParametersInfo failed' }\n  Set-Content -LiteralPath $StatusPath -Encoding UTF8 -Value 'ok'\n} catch {\n  Set-Content -LiteralPath $StatusPath -Encoding UTF8 -Value ('error: ' + $_.Exception.Message)\n  exit 1\n}\n'@",
      "Set-Content -LiteralPath $scriptPath -Encoding UTF8 -Value $applyScript",
      "$cmdScript = '@echo off' + [Environment]::NewLine + 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File \"' + $scriptPath + '\" -Path \"' + $path + '\" -StatusPath \"' + $statusPath + '\"'",
      "Set-Content -LiteralPath $cmdPath -Encoding ASCII -Value $cmdScript",
      "Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue",
      "try { & $cmdPath; if ((Get-Content -LiteralPath $statusPath -ErrorAction SilentlyContinue) -eq 'ok') { return } } catch {}",
      "Remove-Item -LiteralPath $statusPath -Force -ErrorAction SilentlyContinue",
      "$taskTime = (Get-Date).AddMinutes(1).ToString('HH:mm')",
      "$taskCommand = 'cmd.exe /c \"' + $cmdPath + '\"'",
      "& schtasks.exe /Create /TN $taskName /TR $taskCommand /SC ONCE /ST $taskTime /F /IT | Out-Null",
      "& schtasks.exe /Run /TN $taskName | Out-Null",
      "Start-Sleep -Seconds 5",
      "$status = Get-Content -LiteralPath $statusPath -ErrorAction SilentlyContinue",
      "if ($status -ne 'ok') { if (-not $status) { $status = 'Interactive wallpaper task did not report success' }; throw $status }",
    ].join("; "));
  }
  if (platform === "macos") {
    return [
      "set -eu",
      `file="$HOME/NovaManagedDesktop/${fileName}"`,
      "uri=\"file://$file\"",
      "plist=\"$HOME/Library/Application Support/com.apple.wallpaper/Store/Index.plist\"",
      "if [ -f \"$plist\" ]; then",
      "for key in ':AllSpacesAndDisplays:Desktop:Content:Choices:0:Files:0:relative' ':SystemDefault:Desktop:Content:Choices:0:Files:0:relative'; do /usr/libexec/PlistBuddy -c \"Set $key $uri\" \"$plist\" 2>/dev/null || true; done",
      "/usr/bin/killall WallpaperAgent 2>/dev/null || true",
      "/usr/bin/killall Dock 2>/dev/null || true",
      "else",
      `osascript -e 'tell application "Finder" to set desktop picture to POSIX file "'"$file"'"'`,
      "fi",
    ].join("; ");
  }
  return `plasma-apply-wallpaperimage --fill-mode preserveAspectCrop "$HOME/NovaManagedDesktop/${fileName}"`;
}

export function remoteSleepCommand(platform: ManagedComputerPlatform) {
  if (platform === "windows") {
    return windowsPowerShellCommand([
      "$code = 'using System.Runtime.InteropServices; public class NovaPower { [DllImport(\"powrprof.dll\", SetLastError=true)] public static extern bool SetSuspendState(bool hibernate, bool forceCritical, bool disableWakeEvent); }'",
      "Add-Type $code",
      "if (-not [NovaPower]::SetSuspendState($false, $false, $false)) { throw 'SetSuspendState failed' }",
    ].join("; "));
  }
  if (platform === "macos") {
    return "pmset sleepnow";
  }
  throw new Error("Sleep is not supported for this platform");
}

export async function runManagedComputerSsh(computer: ManagedComputer, remoteCommand: string) {
  const client = await connectManagedComputer(computer);
  return new Promise<CommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end();
      reject(new Error(`${computer.name} command timed out after ${computer.commandTimeoutMs}ms`));
    }, computer.commandTimeoutMs);

    client.exec(remoteCommand, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        client.end();
        reject(error);
        return;
      }

      let stdout = "";
      let stderr = "";
      stream
        .on("close", (code: number | null) => {
          clearTimeout(timer);
          client.end();
          if (code === 0) {
            resolve({ stdout, stderr });
            return;
          }
          reject(new Error(`${computer.name} command exited with code ${code}: ${stderr || stdout}`));
        })
        .on("data", (chunk: Buffer) => {
          stdout += chunk.toString("utf8");
        });
      stream.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf8");
      });
    });
  });
}

export async function copyFileToManagedComputer(computer: ManagedComputer, localFilePath: string, remoteFileName: string) {
  assertSafeRemoteFileName(remoteFileName);
  await runManagedComputerSsh(computer, remotePrepareCommand(computer.platform));
  const client = await connectManagedComputer(computer);
  return new Promise<CommandResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      client.end();
      reject(new Error(`${computer.name} SFTP upload timed out after ${computer.commandTimeoutMs}ms`));
    }, computer.commandTimeoutMs);

    client.sftp((error, sftp) => {
      if (error) {
        clearTimeout(timer);
        client.end();
        reject(error);
        return;
      }

      sftp.fastPut(localFilePath, `NovaManagedDesktop/${remoteFileName}`, (uploadError) => {
        clearTimeout(timer);
        client.end();
        if (uploadError) {
          reject(uploadError);
          return;
        }
        resolve({ stdout: "", stderr: "" });
      });
    });
  });
}

/**
 * Dispatch the suspend command and return as soon as it is on the wire. A
 * machine tears down its own SSH session as it powers off, so a clean exit is
 * the exception, not the rule: the close/reset that follows is the expected
 * sign it is going to sleep, never a reason to wait around or retry (a retry
 * would just wake it). We only surface a failure to *connect* - that means
 * nothing was sent and the box never slept.
 */
async function dispatchSleepCommand(computer: ManagedComputer, remoteCommand: string) {
  const client = await connectManagedComputer(computer);
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      client.end();
      resolve();
    };
    // Resolve once the command has had a moment to land, regardless of whether
    // the channel ever closes cleanly.
    const timer = setTimeout(finish, 2_500);
    client.once("error", () => {
      clearTimeout(timer);
      finish();
    });
    client.exec(remoteCommand, (error, stream) => {
      if (error) {
        clearTimeout(timer);
        finish();
        return;
      }
      stream
        .on("close", () => {
          clearTimeout(timer);
          finish();
        })
        .on("data", () => undefined);
      stream.stderr.on("data", () => undefined);
    });
  });
}

export async function sleepManagedComputer(id: string) {
  const computer = await getManagedComputer(id);
  if (!computer.capabilities.sleep) {
    throw new Error(`${computer.name} is not configured for sleep`);
  }
  // Mark it sleeping up-front so any wallpaper sync racing this request stands
  // down instead of waking the machine back up.
  markComputerSleeping(computer.id);
  try {
    await dispatchSleepCommand(computer, remoteSleepCommand(computer.platform));
  } catch (error) {
    // The connection itself failed: nothing was sent, so it never slept. Drop
    // the suppression and report the failure to the caller.
    clearComputerSleeping(computer.id);
    throw error;
  }
  return { action: "sleep" as const, id: computer.id, name: computer.name };
}

// Where the dashboard broadcasts the wake packet. A sleeping machine answers no
// SSH, so wake is Wake-on-LAN: a magic packet broadcast on the LAN. The
// dashboard container runs with host networking, so the limited broadcast
// reaches the local segment.
const WOL_BROADCAST_ADDRESS = process.env.NOVA_WOL_BROADCAST ?? "255.255.255.255";
const WOL_PORTS = [9, 7];

/**
 * Build a Wake-on-LAN magic packet: 6 bytes of 0xFF followed by the 6-byte MAC
 * repeated 16 times (102 bytes total). Exported for unit testing.
 */
export function buildWakeOnLanPacket(macAddress: string): Buffer {
  const hex = macAddress.replace(/[^0-9a-fA-F]/g, "");
  if (hex.length !== 12) {
    throw new Error(`Invalid MAC address: ${macAddress}`);
  }
  const mac = Buffer.from(hex, "hex");
  const packet = Buffer.alloc(102, 0xff);
  for (let repeat = 0; repeat < 16; repeat += 1) {
    mac.copy(packet, 6 + repeat * 6);
  }
  return packet;
}

async function sendWakeOnLan(macAddress: string) {
  const packet = buildWakeOnLanPacket(macAddress);
  await new Promise<void>((resolve, reject) => {
    const socket = createSocket("udp4");
    let settled = false;
    const done = (error?: Error) => {
      if (settled) {
        return;
      }
      settled = true;
      try {
        socket.close();
      } catch {
        // Socket may already be closing; nothing else to do.
      }
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.once("error", (error) => done(error));
    socket.bind(() => {
      socket.setBroadcast(true);
      let remaining = WOL_PORTS.length;
      for (const port of WOL_PORTS) {
        socket.send(packet, 0, packet.length, port, WOL_BROADCAST_ADDRESS, (error) => {
          if (error) {
            done(error);
            return;
          }
          remaining -= 1;
          if (remaining === 0) {
            done();
          }
        });
      }
    });
  });
}

export async function wakeManagedComputer(id: string) {
  const computer = await getManagedComputer(id);
  if (!computer.capabilities.wake) {
    throw new Error(`${computer.name} is not configured for wake-on-LAN`);
  }
  if (!computer.macAddress) {
    throw new Error(`${computer.name} has no MAC address configured`);
  }
  await sendWakeOnLan(computer.macAddress);
  // It is on its way up: lift the sleep suppression so wallpaper sync and other
  // SSH paths can reach it again.
  clearComputerSleeping(computer.id);
  return { action: "wake" as const, id: computer.id, name: computer.name };
}
