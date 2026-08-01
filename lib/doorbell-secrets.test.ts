import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  decryptStore,
  encryptStore,
  hasDoorbellSecretKey,
  readDoorbellSecrets,
  templateFromSamples,
  writeDoorbellSecrets,
} from "./doorbell-secrets";
import type { DoorbellSecretTemplate } from "./doorbell";

const KEY = randomBytes(32).toString("base64");

const template: DoorbellSecretTemplate = {
  id: "guest",
  intervals: [200, 200, 400],
  tolerance: 0.25,
  paceRange: [0.65, 1.5],
  sampleCount: 5,
};

let dir: string;

beforeEach(async () => {
  process.env.NOVA_DOORBELL_SECRET_KEY = KEY;
  dir = await mkdtemp(path.join(tmpdir(), "nova-doorbell-"));
});

afterEach(async () => {
  delete process.env.NOVA_DOORBELL_SECRET_KEY;
  await rm(dir, { force: true, recursive: true });
  vi.restoreAllMocks();
});

describe("encryptStore / decryptStore", () => {
  it("round-trips templates", () => {
    const blob = encryptStore({ version: 1, templates: [template] });
    expect(decryptStore(blob).templates).toEqual([template]);
  });

  it("produces different ciphertext each time", () => {
    const a = encryptStore({ version: 1, templates: [template] });
    const b = encryptStore({ version: 1, templates: [template] });
    expect(a.equals(b)).toBe(false);
  });

  it("never leaves the intervals readable in the blob", () => {
    const blob = encryptStore({ version: 1, templates: [template] });
    expect(blob.toString("utf8")).not.toContain("intervals");
    expect(blob.toString("utf8")).not.toContain("guest");
  });

  it("rejects a tampered blob rather than returning altered templates", () => {
    const blob = encryptStore({ version: 1, templates: [template] });
    blob[blob.length - 1] ^= 0xff;
    expect(() => decryptStore(blob)).toThrow();
  });

  it("rejects a blob encrypted under a different key", () => {
    const blob = encryptStore({ version: 1, templates: [template] });
    const other = Buffer.from(randomBytes(32));
    expect(() => decryptStore(blob, other)).toThrow();
  });
});

describe("hasDoorbellSecretKey", () => {
  it("is false with no key", () => {
    delete process.env.NOVA_DOORBELL_SECRET_KEY;
    expect(hasDoorbellSecretKey()).toBe(false);
  });

  it("is false for a key of the wrong length", () => {
    process.env.NOVA_DOORBELL_SECRET_KEY = randomBytes(16).toString("base64");
    expect(hasDoorbellSecretKey()).toBe(false);
  });

  it("is true for a 32-byte key", () => {
    expect(hasDoorbellSecretKey()).toBe(true);
  });
});

describe("readDoorbellSecrets / writeDoorbellSecrets", () => {
  it("returns nothing when no store has been written", async () => {
    expect(await readDoorbellSecrets(path.join(dir, "missing.enc"))).toEqual([]);
  });

  it("round-trips through the file", async () => {
    const file = path.join(dir, "secrets.enc");
    await writeDoorbellSecrets([template], file);
    expect(await readDoorbellSecrets(file)).toEqual([template]);
  });

  it("leaves no plaintext on disk", async () => {
    const file = path.join(dir, "secrets.enc");
    await writeDoorbellSecrets([template], file);
    const raw = await readFile(file, "utf8");
    expect(raw).not.toContain("guest");
    expect(raw).not.toContain("200");
  });

  it("fails closed on a corrupt store instead of throwing into ingest", async () => {
    const file = path.join(dir, "secrets.enc");
    await writeFile(file, Buffer.from("not an encrypted store"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readDoorbellSecrets(file)).toEqual([]);
    expect(spy).toHaveBeenCalled();
  });

  it("fails closed when the key is missing", async () => {
    const file = path.join(dir, "secrets.enc");
    await writeDoorbellSecrets([template], file);
    delete process.env.NOVA_DOORBELL_SECRET_KEY;
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await readDoorbellSecrets(file)).toEqual([]);
    expect(spy).toHaveBeenCalled();
  });
});

describe("templateFromSamples", () => {
  it("takes the median so one fumbled repetition cannot drag the rhythm", () => {
    const t = templateFromSamples("guest", [
      [200, 400],
      [210, 410],
      [900, 405], // fumbled first gap
      [205, 395],
      [195, 400],
    ]);
    expect(t.intervals[0]).toBe(205);
    expect(t.intervals[1]).toBe(400);
    expect(t.sampleCount).toBe(5);
  });

  it("averages the middle pair for an even sample count", () => {
    const t = templateFromSamples("guest", [[100], [200], [300], [400]]);
    expect(t.intervals).toEqual([250]);
  });

  it("refuses samples of differing length", () => {
    expect(() => templateFromSamples("guest", [[200, 400], [200]])).toThrow(
      /same number of intervals/,
    );
  });

  it("refuses an empty enrolment", () => {
    expect(() => templateFromSamples("guest", [])).toThrow(/at least one sample/);
  });
});
