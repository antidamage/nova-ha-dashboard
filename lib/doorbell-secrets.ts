/**
 * Encrypted storage for secret-knock templates.
 *
 * The shared dashboard config is served to every browser on the network, so a
 * rhythm template kept there would be a published door key. Templates live
 * here instead: encrypted at rest with a key held outside the repository, and
 * exposed to the rest of the app only through the coordinator.
 *
 * Nothing in this module is ever returned to a client. The config API returns
 * `DoorbellSecretMeta` (id, label, configured, sample count) and nothing else.
 */

import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { DoorbellSecretTemplate } from "./doorbell";

const KEY_ENV = "NOVA_DOORBELL_SECRET_KEY";
const DEFAULT_PATH = path.join(process.cwd(), "data", "doorbell-secrets.json.enc");
const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;

export type DoorbellSecretStore = {
  version: 1;
  templates: DoorbellSecretTemplate[];
};

const EMPTY: DoorbellSecretStore = { version: 1, templates: [] };

export class DoorbellSecretKeyMissingError extends Error {
  constructor() {
    super(
      `${KEY_ENV} is not set. Secret knocks stay disabled until it is: generate `
      + "one with `openssl rand -base64 32` and put it in the dashboard's environment.",
    );
    this.name = "DoorbellSecretKeyMissingError";
  }
}

function readKey(): Buffer {
  const raw = process.env[KEY_ENV];
  if (!raw) {
    throw new DoorbellSecretKeyMissingError();
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(`${KEY_ENV} must decode to exactly 32 bytes (got ${key.length})`);
  }
  return key;
}

/** True when a key is configured at all — used to gate the access UI. */
export function hasDoorbellSecretKey(): boolean {
  try {
    readKey();
    return true;
  } catch {
    return false;
  }
}

export function encryptStore(store: DoorbellSecretStore, key = readKey()): Buffer {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const body = Buffer.concat([
    cipher.update(JSON.stringify(store), "utf8"),
    cipher.final(),
  ]);
  // iv | tag | ciphertext, so the file is self-describing without a header.
  return Buffer.concat([iv, cipher.getAuthTag(), body]);
}

export function decryptStore(blob: Buffer, key = readKey()): DoorbellSecretStore {
  if (blob.length < IV_BYTES + 16) {
    throw new Error("doorbell secret store is truncated");
  }
  const iv = blob.subarray(0, IV_BYTES);
  const tag = blob.subarray(IV_BYTES, IV_BYTES + 16);
  const body = blob.subarray(IV_BYTES + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const json = Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
  const parsed = JSON.parse(json) as DoorbellSecretStore;
  if (parsed?.version !== 1 || !Array.isArray(parsed.templates)) {
    throw new Error("doorbell secret store has an unexpected shape");
  }
  return parsed;
}

/**
 * Load the templates. A missing file is normal (no secrets enrolled yet); a
 * missing key or a corrupt file is not, and both resolve to "no templates" so
 * the door stays shut rather than throwing into the ingest path.
 */
export async function readDoorbellSecrets(
  filePath = DEFAULT_PATH,
): Promise<DoorbellSecretTemplate[]> {
  let blob: Buffer;
  try {
    blob = await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  try {
    return decryptStore(blob).templates;
  } catch (error) {
    // Deliberately loud but non-fatal: a store we cannot read must never grant
    // access, and it must never take the doorbell alert path down with it.
    console.error("[nova-dashboard] doorbell secret store unreadable", {
      message: (error as Error)?.message,
    });
    return [];
  }
}

export async function writeDoorbellSecrets(
  templates: DoorbellSecretTemplate[],
  filePath = DEFAULT_PATH,
): Promise<void> {
  const blob = encryptStore({ ...EMPTY, templates });
  await mkdir(path.dirname(filePath), { recursive: true });
  // Write-then-rename so a crash mid-write cannot leave a half-written store
  // that would silently disable every secret.
  const tmp = `${filePath}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, blob, { mode: 0o600 });
  await rename(tmp, filePath);
}

/**
 * Build a template from enrolment samples.
 *
 * Uses the median of each interval rather than the mean, so one fumbled
 * repetition during enrolment cannot drag the stored rhythm off target.
 */
export function templateFromSamples(
  id: string,
  samples: number[][],
  options: { tolerance?: number; paceRange?: [number, number] } = {},
): DoorbellSecretTemplate {
  if (samples.length === 0) {
    throw new Error("at least one sample is required");
  }
  const width = samples[0].length;
  if (width === 0 || samples.some((s) => s.length !== width)) {
    throw new Error("every enrolment sample must have the same number of intervals");
  }

  const intervals: number[] = [];
  for (let i = 0; i < width; i += 1) {
    const column = samples.map((s) => s[i]).sort((a, b) => a - b);
    const mid = Math.floor(column.length / 2);
    intervals.push(
      column.length % 2 === 0 ? Math.round((column[mid - 1] + column[mid]) / 2) : column[mid],
    );
  }

  return {
    id,
    intervals,
    tolerance: options.tolerance ?? 0.25,
    paceRange: options.paceRange ?? [0.65, 1.5],
    sampleCount: samples.length,
  };
}
