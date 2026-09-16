// Pure normalisation of a stored or submitted computer record.
import { randomUUID } from "crypto";
import path from "path";
import { DEFAULT_COMMAND_TIMEOUT_MS, KEY_DIR, MAX_COMMAND_TIMEOUT_MS, MIN_COMMAND_TIMEOUT_MS } from "./constants";
import type { ManagedComputer, ManagedComputerCapabilities, ManagedComputerOrientation, ManagedComputerPlatform } from "./types";

export function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function normalizedId(value: unknown, fallback = `computer_${randomUUID()}`) {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return /^[a-z0-9][a-z0-9_-]{1,63}$/.test(text) ? text : fallback;
}

export function normalizedNetworkName(value: unknown) {
  const text = typeof value === "string" ? value.trim() : "";
  if (!text || /\s/.test(text)) {
    return "";
  }
  return text.slice(0, 253);
}

export function normalizedPlatform(value: unknown): ManagedComputerPlatform {
  if (value === "windows" || value === "macos" || value === "kde-linux") {
    return value;
  }
  return "windows";
}

export function normalizedOrientation(value: unknown): ManagedComputerOrientation {
  return value === "portrait" ? "portrait" : "landscape";
}

// HA area ids are lowercase snake/kebab slugs. Anything else (including the
// empty string) means "unassigned" rather than a validation error, since a
// satellite is perfectly usable before it has been placed in a room.
export const ROOM_ID_PATTERN = /^[a-z0-9_-]{1,64}$/;

export function normalizedRoomId(value: unknown): string {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ROOM_ID_PATTERN.test(text) ? text : "";
}

export function normalizedTimeout(value: unknown) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_COMMAND_TIMEOUT_MS;
  }
  return Math.max(MIN_COMMAND_TIMEOUT_MS, Math.min(MAX_COMMAND_TIMEOUT_MS, Math.round(parsed)));
}

export function normalizedPort(value: unknown) {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    return undefined;
  }
  return parsed;
}

export function normalizedCapabilities(value: unknown, id: string): ManagedComputerCapabilities {
  const record = isRecord(value) ? value : {};
  return {
    lockScreen: record.lockScreen !== false,
    sleep: record.sleep === true,
    wake: record.wake === true,
    wallpaper: record.wallpaper !== false,
    voiceSatellite: record.voiceSatellite === true,
  };
}

// Accept the usual MAC notations (AA:BB:.., AA-BB-.., aabb.aabb.aabb, bare hex)
// and normalise to upper-case colon form. Anything that is not exactly 12 hex
// digits becomes "" (no MAC = not wakeable).
export function normalizedMac(value: unknown) {
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

export function defaultKeyPath(id: string) {
  return path.join(KEY_DIR, `${id}_ed25519`);
}

export function normalizeComputer(value: unknown): ManagedComputer | null {
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
