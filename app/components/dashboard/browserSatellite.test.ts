import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrowserSatellite,
  browserSatelliteReconnectDelay,
} from "./browserSatellite";

class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 3;

  readyState = FakeSocket.CONNECTING;
  binaryType = "";
  sent: unknown[] = [];

  constructor(readonly url: string) {
    super();
    FakeSocket.instances.push(this);
  }

  send(value: unknown) {
    this.sent.push(value);
  }

  open() {
    this.readyState = FakeSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  close(code = 1000, reason = "") {
    this.readyState = FakeSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason }));
  }
}

const hello = {
  satelliteId: "web-ipad",
  displayName: "Web Dashboard",
  roomId: "lounge",
  capturePolicy: "always" as const,
};

describe("BrowserSatellite recovery and playback ownership", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    vi.stubGlobal("WebSocket", FakeSocket);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("uses bounded exponential reconnect delays", () => {
    expect(browserSatelliteReconnectDelay(0)).toBe(500);
    expect(browserSatelliteReconnectDelay(3)).toBe(4_000);
    expect(browserSatelliteReconnectDelay(20)).toBe(30_000);
  });

  it("reconnects a closed current socket and ignores stale generations", () => {
    const satellite = new BrowserSatellite("wss://nova/voice-satellite", hello);
    const internal = satellite as unknown as {
      stopped: boolean;
      connectSocket(): void;
    };
    internal.stopped = false;
    internal.connectSocket();
    const first = FakeSocket.instances[0];
    first.open();
    first.close(1006, "network lost");

    vi.advanceTimersByTime(499);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(FakeSocket.instances).toHaveLength(2);

    // A late close from the obsolete generation cannot schedule another socket.
    first.dispatchEvent(new CloseEvent("close", { code: 1006 }));
    vi.advanceTimersByTime(30_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it("cancels scheduled audio when a newer playback stream arrives", () => {
    const satellite = new BrowserSatellite("wss://nova/voice-satellite", hello);
    const stop = vi.fn();
    const disconnect = vi.fn();
    const internal = satellite as unknown as {
      activePlaybackId: string | null;
      scheduledSources: Set<{ stop(): void; disconnect(): void }>;
      onControl(text: string): void;
      sendControl(payload: unknown): void;
    };
    const controls = vi.spyOn(internal, "sendControl").mockImplementation(() => undefined);
    internal.onControl(JSON.stringify({ type: "playback", playbackId: "first" }));
    internal.scheduledSources.add({ stop, disconnect });

    internal.onControl(JSON.stringify({ type: "playback", playbackId: "second" }));

    expect(stop).toHaveBeenCalledOnce();
    expect(disconnect).toHaveBeenCalledOnce();
    expect(controls).toHaveBeenCalledWith({
      type: "playback_cancelled",
      playbackId: "first",
    });
    expect(internal.activePlaybackId).toBe("second");
  });
});
