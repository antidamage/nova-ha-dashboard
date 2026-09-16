import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  playControlSound,
  playUxSound,
  previewSound,
  resolveUxSoundUrl,
  setActiveControlSound,
  setSoundLibrary,
} from "./controlSound";
import { DEFAULT_UX_SOUNDS, type UxSoundAssignments } from "./uxSoundActions";
import type { SoundLibraryEntry } from "../../../lib/sound-library";

const CLICK_URL = "/sounds/ux/medium-mechanical-click.mp3";
const UPLOAD_URL = "/api/sounds/soft-click";

const LIBRARY: SoundLibraryEntry[] = [
  { id: "medium-mechanical-click", name: "Medium mechanical click", origin: "builtin", bytes: 0, updatedAt: null },
  { id: "chime-classic", name: "Chime (classic)", origin: "builtin", bytes: 0, updatedAt: null },
  { id: "soft-click", name: "Soft click", origin: "upload", bytes: 900, updatedAt: null },
];

type FakeBufferSource = {
  buffer: unknown;
  connect: ReturnType<typeof vi.fn>;
  disconnect: ReturnType<typeof vi.fn>;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
  onended: (() => void) | null;
};

// Buffer sources created during the current test. Module-level so the (singleton)
// AudioContext the engine caches always records into the same array even across
// stub re-installs; reset at the start of each test.
const created: FakeBufferSource[] = [];

class FakeAudioContext {
  state = "running";
  currentTime = 0;
  destination = {};
  resume = vi.fn(async () => undefined);

  createGain() {
    return {
      gain: {
        value: 0.6,
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn(),
        cancelScheduledValues: vi.fn(),
      },
      connect: vi.fn((next: unknown) => next),
      disconnect: vi.fn(),
    };
  }

  createBufferSource(): FakeBufferSource {
    const node: FakeBufferSource = {
      buffer: null,
      connect: vi.fn((next: unknown) => next),
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      onended: null,
    };
    created.push(node);
    return node;
  }

  decodeAudioData(_data: ArrayBuffer) {
    return Promise.resolve({} as AudioBuffer);
  }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

// A voice that is still playing is never stopped explicitly (a buffer source ends
// on its own). Trimming the oldest calls stop(), so a stop() call is the signal
// that a voice was cancelled.
function wasCancelled(node: FakeBufferSource) {
  return node.stop.mock.calls.length > 0;
}

/** The default assignments, the library loaded, everything decoded. */
async function ready(assignments: Partial<UxSoundAssignments> = {}, volume = 60) {
  setSoundLibrary(LIBRARY);
  setActiveControlSound({ volume }, { ...DEFAULT_UX_SOUNDS, ...assignments });
  await flush();
}

describe("ux sound engine", () => {
  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })),
    );
  });

  afterEach(() => {
    // Drain active voices so module state doesn't leak between tests.
    for (const node of created) {
      node.onended?.();
    }
    vi.unstubAllGlobals();
  });

  it("keeps only the two newest voices, cancelling older ones", async () => {
    await ready();

    playControlSound();
    playControlSound();
    playControlSound();

    expect(created).toHaveLength(3);
    expect(wasCancelled(created[0])).toBe(true);
    expect(wasCancelled(created[1])).toBe(false);
    expect(wasCancelled(created[2])).toBe(false);
  });

  it("cancels each older voice as newer presses arrive", async () => {
    await ready();

    playControlSound();
    playControlSound();
    playControlSound();
    playControlSound();

    expect(created).toHaveLength(4);
    expect(wasCancelled(created[0])).toBe(true);
    expect(wasCancelled(created[1])).toBe(true);
    expect(wasCancelled(created[2])).toBe(false);
    expect(wasCancelled(created[3])).toBe(false);
  });

  it("plays nothing when the action is set to None", async () => {
    await ready({ buttonPress: null });
    playControlSound();
    await flush();
    expect(created).toHaveLength(0);
  });

  it("plays nothing at zero volume", async () => {
    await ready({}, 0);
    playControlSound();
    await flush();
    expect(created).toHaveLength(0);
  });

  it("a volume override still plays the assigned sound", async () => {
    await ready();
    playControlSound({ volume: 40 });
    expect(created).toHaveLength(1);
  });

  // The bug this replaced: an undecoded clip was skipped, so the config page's
  // preview had to be pressed twice to hear anything.
  it("plays an undecoded clip on the first press, not the second", async () => {
    setSoundLibrary(LIBRARY);
    setActiveControlSound({ volume: 60 }, { ...DEFAULT_UX_SOUNDS, buttonPress: null });
    await flush();

    previewSound(UPLOAD_URL);
    expect(created).toHaveLength(0);
    await flush();
    expect(created).toHaveLength(1);
  });

  it("resolves each assignment to its clip, and a deleted clip to the default", async () => {
    await ready({ timerAlert: "chime-classic", dialClick: "gone-for-good" });

    expect(resolveUxSoundUrl("timerAlert")).toBe("/sounds/ux/chime-classic.mp3");
    expect(resolveUxSoundUrl("dialClick")).toBe(CLICK_URL);
    expect(resolveUxSoundUrl("buttonPress")).toBe(CLICK_URL);
  });

  it("resolves a built-in before the library has loaded", async () => {
    setSoundLibrary([]);
    setActiveControlSound({ volume: 60 }, { ...DEFAULT_UX_SOUNDS });
    await flush();
    expect(resolveUxSoundUrl("timerAlert")).toBe("/sounds/ux/chime-classic.mp3");
  });

  it("migrates the retired sentinels rather than falling silent", async () => {
    await ready({ buttonPress: "button-press", timerAlert: "timer-chime" });
    expect(resolveUxSoundUrl("buttonPress")).toBe(CLICK_URL);
    expect(resolveUxSoundUrl("timerAlert")).toBe("/sounds/ux/chime-classic.mp3");

    playUxSound("timerAlert");
    expect(created).toHaveLength(1);
  });

  it("plays the reminder MP3 for the reminder alert", async () => {
    await ready();
    expect(resolveUxSoundUrl("reminderAlert")).toBe("/api/tasks/audio");
  });
});
