import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { COMMAND_WINDOW_MS, readPendingPlayCommand, readPlayResult, writePlayCommand, writePlayResult } from "./appletv-command";

const preset = { name: "Excellent", shuffle: false, repeat: "off" as const };
let dir = "";

const statePath = () => path.join(dir, "command.json");

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "nova-appletv-command-"));
  process.env.NOVA_APPLETV_COMMAND_STATE = statePath();
  process.env.NOVA_APPLETV_PLAY_RESULT = path.join(dir, "result.json");
});

afterEach(() => {
  delete process.env.NOVA_APPLETV_COMMAND_STATE;
  delete process.env.NOVA_APPLETV_PLAY_RESULT;
  rmSync(dir, { force: true, recursive: true });
});

describe("the command a preset press leaves for the app", () => {
  it("is nothing at all before anything is pressed", async () => {
    await expect(readPendingPlayCommand()).resolves.toBeNull();
  });

  it("carries the preset, the playback modes, and a rising id", async () => {
    const first = await writePlayCommand({ name: "Excellent", shuffle: true, repeat: "infinite" });

    expect(first).toMatchObject({ name: "Excellent", shuffle: true, repeat: "infinite" });
    expect((await readPendingPlayCommand())?.id).toBe(first.id);

    const second = await writePlayCommand({ name: "Cool", shuffle: false, repeat: "all" });
    expect(second.id).toBeGreaterThan(first.id);
    expect((await readPendingPlayCommand())?.name).toBe("Cool");
  });

  it("gives two presses at once two ids, in order, rather than one overwritten", async () => {
    const [first, second] = await Promise.all([
      writePlayCommand({ name: "Excellent", shuffle: false, repeat: "off" }),
      writePlayCommand({ name: "Cool", shuffle: false, repeat: "off" }),
    ]);

    // Both presses are records: an id reused would mean one press's command was
    // overwritten and would never run.
    expect(first.id).not.toBe(second.id);
    expect((await readPendingPlayCommand())?.id).toBe(Math.max(first.id, second.id));
  });

  it("hands nothing over for a command dated in the future", async () => {
    const written = await writePlayCommand(preset);
    const earlier = new Date(Date.parse(written.at) - 60_000);

    // A hand-edited file, or a clock that moved back, must not leave a command
    // that never ages out.
    await expect(readPendingPlayCommand(earlier)).resolves.toBeNull();
  });

  it("hands nothing over once the press is stale", async () => {
    const written = await writePlayCommand(preset);
    const stale = new Date(Date.parse(written.at) + COMMAND_WINDOW_MS + 1);

    // A press made while the television was asleep must not start music when it
    // next wakes.
    await expect(readPendingPlayCommand(stale)).resolves.toBeNull();
    // The file still carries its id, so the next press cannot reuse one.
    const next = await writePlayCommand(preset, stale);
    expect(next.id).toBeGreaterThan(written.id);
  });

  it("still counts from a file it cannot parse, rather than reusing an id", async () => {
    writeFileSync(statePath(), "{ not json", "utf8");

    await expect(readPendingPlayCommand()).resolves.toBeNull();
    const next = await writePlayCommand(preset);
    expect(Number.isFinite(next.id)).toBe(true);
    expect(next.id).toBeGreaterThan(0);
    await expect(readPendingPlayCommand()).resolves.toMatchObject({ name: "Excellent", id: next.id });
  });

  it("reads rubbish inside a real record as nothing set", async () => {
    writeFileSync(
      statePath(),
      JSON.stringify({ at: new Date().toISOString(), id: 4, name: "Cool", repeat: "sometimes", shuffle: "yes" }),
      "utf8",
    );

    expect(await readPendingPlayCommand()).toEqual({
      at: expect.any(String),
      id: 4,
      name: "Cool",
      repeat: "off",
      shuffle: false,
    });
  });

  it("hands over nothing for a record that is not one", async () => {
    for (const value of [{}, { id: "1", name: "Cool", at: "x" }, { id: 1, at: "x" }, { id: 1, name: "", at: "x" }]) {
      writeFileSync(statePath(), JSON.stringify(value), "utf8");
      await expect(readPendingPlayCommand(), JSON.stringify(value)).resolves.toBeNull();
    }
  });
});

describe("what the app reports back about a press", () => {
  it("is nothing until the app has said anything", async () => {
    await expect(readPlayResult()).resolves.toBeNull();
  });

  it("records that it played, and which preset it was", async () => {
    await writePlayResult({ id: 2, name: "Excellent", played: true });

    expect(await readPlayResult()).toMatchObject({ id: 2, name: "Excellent", played: true, reason: null });
  });

  it("records why it did not, in the app's words — that is the point of it", async () => {
    await writePlayResult({ id: 3, name: "Snake", played: false, reason: "NO PLAYLIST NAMED SNAKE" });

    expect(await readPlayResult()).toMatchObject({ played: false, reason: "NO PLAYLIST NAMED SNAKE" });
  });

  it("reads a file that is not a report as nothing at all", async () => {
    for (const value of [{}, { id: 1, name: "x" }, { id: "1", name: "x", at: "y" }]) {
      writeFileSync(path.join(dir, "result.json"), JSON.stringify(value), "utf8");
      await expect(readPlayResult(), JSON.stringify(value)).resolves.toBeNull();
    }
  });
});
