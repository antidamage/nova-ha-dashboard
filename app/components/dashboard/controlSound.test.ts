import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { playControlSound, setActiveControlSound } from "./controlSound";

const SOURCE = "data:audio/wav;base64,UklGRiQAAABXQVZF";

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

async function loadSound() {
  setActiveControlSound({ name: "click.wav", source: SOURCE, volume: 60 });
  await flush();
}

describe("control sound engine", () => {
  beforeEach(() => {
    created.length = 0;
    vi.stubGlobal("AudioContext", FakeAudioContext as unknown as typeof AudioContext);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ arrayBuffer: async () => new ArrayBuffer(8) })),
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
    await loadSound();

    playControlSound();
    playControlSound();
    playControlSound();

    expect(created).toHaveLength(3);
    expect(wasCancelled(created[0])).toBe(true);
    expect(wasCancelled(created[1])).toBe(false);
    expect(wasCancelled(created[2])).toBe(false);
  });

  it("cancels each older voice as newer presses arrive", async () => {
    await loadSound();

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

  it("plays nothing when no sound is uploaded", async () => {
    setActiveControlSound({ name: null, source: null, volume: 60 });
    await flush();
    playControlSound();
    expect(created).toHaveLength(0);
  });

  it("plays nothing at zero volume", async () => {
    await loadSound();
    setActiveControlSound({ name: "click.wav", source: SOURCE, volume: 0 });
    await flush();
    playControlSound();
    expect(created).toHaveLength(0);
  });

  it("a volume override still plays the uploaded sound", async () => {
    await loadSound();
    playControlSound({ volume: 40 });
    expect(created).toHaveLength(1);
  });
});
