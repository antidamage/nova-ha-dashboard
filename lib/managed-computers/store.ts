// Sole owner of the package's module state and disk I/O: the write queue, the
// JSON store, and each computer's SSH key pair.
import { chmod, mkdir, readFile, rename, writeFile } from "fs/promises";
import path from "path";
import { utils } from "ssh2";
import { isRecord, normalizeComputer, normalizedId, normalizedRoomId } from "./computer-model";
import { STORE_PATH } from "./constants";
import type { ManagedComputer, ManagedComputerPublic, ManagedComputerStore } from "./types";

export let writeQueue = Promise.resolve();

export async function fileExists(filePath: string) {
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

export function generateManagedKeyPair(comment: string) {
  const keyPair = utils.generateKeyPairSync("ed25519", { comment });
  return { privateKey: keyPair.private, publicLine: keyPair.public };
}

export async function privateKeyIsUsable(filePath: string) {
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

export async function ensureKey(computer: ManagedComputer): Promise<ManagedComputer> {
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

export async function readStore(): Promise<ManagedComputerStore> {
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

export async function writeStore(store: ManagedComputerStore) {
  await mkdir(path.dirname(STORE_PATH), { recursive: true });
  const tempPath = `${STORE_PATH}.${process.pid}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
  await chmod(tempPath, 0o600).catch(() => undefined);
  await rename(tempPath, STORE_PATH);
  await chmod(STORE_PATH, 0o600).catch(() => undefined);
}

export async function publicComputer(computer: ManagedComputer): Promise<ManagedComputerPublic> {
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
