"use client";

// Browser voice-satellite runtime: microphone capture + playback over the
// dashboard's mTLS bridge (lib/voice-satellite-bridge.ts → Iridium
// /v1/satellites). It speaks the same NVAF wire protocol as the native
// satellites: 16 kHz mono int16, 20 ms (640-byte) frames wrapped in a 28-byte
// header, JSON control messages for the handshake and playback lifecycle.
//
// This is plain (non-React) so it can be driven imperatively by the voice-mode
// store. It never opens the mic on custom-input devices — those bind to a
// native satellite instead and never construct this runtime.

import {
  NVAF_KIND_AUDIO_INPUT,
  NVAF_KIND_AUDIO_OUTPUT,
  NVAF_PROTOCOL_VERSION,
  nvafFrameKind,
  nvafPayload,
  packNvafFrame,
} from "../../../lib/nvaf";

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SAMPLES = 320; // 20 ms at 16 kHz
const FRAME_BYTES = FRAME_SAMPLES * 2; // 640

export type BrowserSatelliteHello = {
  satelliteId: string;
  displayName: string;
  roomId: string;
  capturePolicy: "always" | "push-to-talk";
};

export type BrowserSatelliteCallbacks = {
  onHelloAck?: () => void;
  onPlaybackStart?: () => void;
  onPlaybackDone?: () => void;
  onClose?: (reason: string) => void;
  onError?: (error: unknown) => void;
  onStateChange?: (state: BrowserSatelliteState) => void;
};

export type BrowserSatelliteState =
  | "starting"
  | "connecting"
  | "connected"
  | "recovering"
  | "stopped";

export function browserSatelliteReconnectDelay(attempt: number): number {
  return Math.min(30_000, 500 * 2 ** Math.max(0, Math.min(attempt, 6)));
}

export class BrowserSatellite {
  private socket: WebSocket | null = null;
  private captureCtx: AudioContext | null = null;
  private playbackCtx: AudioContext | null = null;
  private worklet: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private stream: MediaStream | null = null;
  private sequence = 0;
  private resampleCarry = 0; // fractional read position carried between blocks
  private pending: number[] = []; // accumulated 16 kHz samples awaiting a full frame
  private playbackSampleRate = TARGET_SAMPLE_RATE;
  private playbackTime = 0;
  private activePlaybackId: string | null = null;
  private playbackStartedSent = false;
  private playbackFinishTimer: ReturnType<typeof setTimeout> | null = null;
  private scheduledSources = new Set<AudioBufferSourceNode>();
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private captureRetryTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectAttempt = 0;
  private generation = 0;
  private stopped = true;

  constructor(
    private readonly url: string,
    private readonly hello: BrowserSatelliteHello,
    private readonly callbacks: BrowserSatelliteCallbacks = {},
  ) {}

  async start(): Promise<void> {
    if (!this.stopped) return;
    this.stopped = false;
    this.callbacks.onStateChange?.("starting");
    window.addEventListener("online", this.onOnline);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    await this.acquireCapture();
    this.connectSocket();
  }

  /** Push-to-talk: ask the server to treat the next segment as wake-initiated. */
  beginTurn(): void {
    this.sendControl({ type: "begin_turn" });
  }

  stop(): void {
    this.stopped = true;
    this.generation += 1;
    this.clearRecoveryTimers();
    window.removeEventListener("online", this.onOnline);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    this.teardownCapture();
    this.cancelPlayback(false);
    if (this.playbackCtx) {
      void this.playbackCtx.close();
      this.playbackCtx = null;
    }
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close(1000, "client stop");
    }
    this.socket = null;
    this.callbacks.onStateChange?.("stopped");
  }

  private readonly onOnline = (): void => {
    this.resumeAudio();
    this.scheduleReconnect(true);
  };

  private readonly onVisibilityChange = (): void => {
    if (document.visibilityState !== "visible") return;
    this.resumeAudio();
    if (!this.stream?.getAudioTracks().some((track) => track.readyState === "live")) {
      void this.recoverCapture();
    }
    this.scheduleReconnect(true);
  };

  private connectSocket(): void {
    if (
      this.stopped ||
      this.socket?.readyState === WebSocket.OPEN ||
      this.socket?.readyState === WebSocket.CONNECTING
    ) {
      return;
    }
    const generation = ++this.generation;
    const socket = new WebSocket(this.url);
    this.socket = socket;
    socket.binaryType = "arraybuffer";
    this.callbacks.onStateChange?.(this.reconnectAttempt ? "recovering" : "connecting");
    socket.addEventListener("open", () => {
      if (this.stopped || generation !== this.generation || this.socket !== socket) return;
      this.reconnectAttempt = 0;
      this.callbacks.onStateChange?.("connected");
      this.sendHello();
    });
    socket.addEventListener("message", (event) => {
      if (generation === this.generation && this.socket === socket) this.onMessage(event);
    });
    socket.addEventListener("close", (event) => {
      if (generation !== this.generation || this.socket !== socket) return;
      this.socket = null;
      this.callbacks.onClose?.(event.reason || `code ${event.code}`);
      this.scheduleReconnect();
    });
    socket.addEventListener("error", (event) => this.callbacks.onError?.(event));
  }

  private scheduleReconnect(immediate = false): void {
    if (this.stopped || this.socket?.readyState === WebSocket.OPEN) return;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const delay = immediate ? 0 : browserSatelliteReconnectDelay(this.reconnectAttempt++);
    this.callbacks.onStateChange?.("recovering");
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectSocket();
    }, delay);
  }

  private sendHello(): void {
    this.sendControl({
      protocolVersion: NVAF_PROTOCOL_VERSION,
      satelliteId: this.hello.satelliteId,
      displayName: this.hello.displayName,
      roomId: this.hello.roomId,
      client: "browser",
      supervisor: "none",
      capturePolicy: this.hello.capturePolicy,
      capabilities: {
        microphone: true,
        speaker: true,
        echoCancellation: true,
        noiseSuppression: true,
        automaticGainControl: true,
        playbackEvents: true,
      },
    });
  }

  private sendControl(payload: unknown): void {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(payload));
    }
  }

  private onMessage(event: MessageEvent): void {
    if (typeof event.data === "string") {
      this.onControl(event.data);
      return;
    }
    const buffer = event.data as ArrayBuffer;
    if (nvafFrameKind(buffer) === NVAF_KIND_AUDIO_OUTPUT) {
      this.playPcm(nvafPayload(buffer));
    }
  }

  private onControl(text: string): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    switch (message.type) {
      case "hello":
        this.callbacks.onHelloAck?.();
        break;
      case "playback":
        this.beginPlayback(String(message.playbackId || ""));
        this.playbackSampleRate = Number(message.sampleRate) || TARGET_SAMPLE_RATE;
        this.callbacks.onPlaybackStart?.();
        break;
      case "playback_done":
        this.completePlayback(String(message.playbackId || ""));
        break;
      case "playback_cancel":
        if (message.playbackId === this.activePlaybackId) {
          this.cancelPlayback(true);
          this.callbacks.onPlaybackDone?.();
        }
        break;
      default:
        break;
    }
  }

  private async acquireCapture(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    for (const track of this.stream.getAudioTracks()) {
      track.addEventListener("ended", this.onCaptureEnded, { once: true });
    }
    await this.startCapture();
  }

  private readonly onCaptureEnded = (): void => {
    if (!this.stopped) void this.recoverCapture();
  };

  private async recoverCapture(): Promise<void> {
    if (this.stopped || this.captureRetryTimer) return;
    this.callbacks.onStateChange?.("recovering");
    this.teardownCapture();
    try {
      await this.acquireCapture();
    } catch (error) {
      this.callbacks.onError?.(error);
      if (!this.stopped) {
        const delay = browserSatelliteReconnectDelay(this.reconnectAttempt++);
        this.captureRetryTimer = setTimeout(() => {
          this.captureRetryTimer = null;
          void this.recoverCapture();
        }, delay);
      }
    }
  }

  private async startCapture(): Promise<void> {
    const ctx = new AudioContext();
    this.captureCtx = ctx;
    await ctx.audioWorklet.addModule("/nova-voice-capture-worklet.js");
    if (this.stopped) return;
    const source = ctx.createMediaStreamSource(this.stream!);
    const worklet = new AudioWorkletNode(ctx, "nova-voice-capture");
    worklet.port.onmessage = (event) => this.onCaptureBlock(event.data as Float32Array, ctx.sampleRate);
    source.connect(worklet);
    // The worklet has no output; a zero-gain sink keeps the graph pulling.
    const sink = ctx.createGain();
    sink.gain.value = 0;
    worklet.connect(sink).connect(ctx.destination);
    this.source = source;
    this.worklet = worklet;
  }

  // Linear-resample a native-rate mono block to 16 kHz and emit full frames.
  private onCaptureBlock(block: Float32Array, sourceRate: number): void {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
    const ratio = sourceRate / TARGET_SAMPLE_RATE;
    let read = this.resampleCarry;
    while (read < block.length) {
      const index = Math.floor(read);
      const frac = read - index;
      const a = block[index];
      const b = index + 1 < block.length ? block[index + 1] : a;
      this.pending.push(a + (b - a) * frac);
      read += ratio;
      if (this.pending.length >= FRAME_SAMPLES) {
        this.emitFrame();
      }
    }
    this.resampleCarry = read - block.length;
  }

  private emitFrame(): void {
    const samples = this.pending.splice(0, FRAME_SAMPLES);
    const payload = new Uint8Array(FRAME_BYTES);
    const view = new DataView(payload.buffer);
    for (let i = 0; i < FRAME_SAMPLES; i += 1) {
      const clamped = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    }
    this.sequence += 1;
    // flags=0: the browser never sets FLAG_PLAYBACK_ACTIVE — server AEC handles echo.
    this.socket!.send(
      packNvafFrame(NVAF_KIND_AUDIO_INPUT, 0, this.sequence, performance.now() * 1e6, payload),
    );
  }

  private playPcm(payload: ArrayBuffer): void {
    const ctx = this.ensurePlaybackCtx();
    const int16 = new Int16Array(payload);
    if (int16.length === 0) return;
    const audioBuffer = ctx.createBuffer(1, int16.length, this.playbackSampleRate);
    const channel = audioBuffer.getChannelData(0);
    for (let i = 0; i < int16.length; i += 1) {
      channel[i] = int16[i] / 0x8000;
    }
    const node = ctx.createBufferSource();
    node.buffer = audioBuffer;
    node.connect(ctx.destination);
    this.scheduledSources.add(node);
    node.addEventListener("ended", () => this.scheduledSources.delete(node), { once: true });
    const now = ctx.currentTime;
    const startAt = Math.max(now, this.playbackTime);
    node.start(startAt);
    this.playbackTime = startAt + audioBuffer.duration;
    if (!this.playbackStartedSent && this.activePlaybackId) {
      this.playbackStartedSent = true;
      this.sendControl({ type: "playback_started", playbackId: this.activePlaybackId });
    }
  }

  private ensurePlaybackCtx(): AudioContext {
    if (!this.playbackCtx) {
      this.playbackCtx = new AudioContext();
    }
    if (this.playbackCtx.state === "suspended") {
      void this.playbackCtx.resume();
    }
    return this.playbackCtx;
  }

  private beginPlayback(playbackId: string): void {
    if (this.activePlaybackId && this.activePlaybackId !== playbackId) {
      this.cancelPlayback(true);
    }
    this.activePlaybackId = playbackId || null;
    this.playbackStartedSent = false;
    this.playbackTime = 0;
  }

  private completePlayback(playbackId: string): void {
    if (!playbackId || playbackId !== this.activePlaybackId) return;
    if (this.playbackFinishTimer) clearTimeout(this.playbackFinishTimer);
    const ctx = this.playbackCtx;
    const delayMs = ctx ? Math.max(0, (this.playbackTime - ctx.currentTime) * 1000) : 0;
    this.playbackFinishTimer = setTimeout(() => {
      this.playbackFinishTimer = null;
      if (this.activePlaybackId !== playbackId) return;
      this.sendControl({ type: "playback_finished", playbackId });
      this.activePlaybackId = null;
      this.callbacks.onPlaybackDone?.();
    }, delayMs);
  }

  private cancelPlayback(report: boolean): void {
    const playbackId = this.activePlaybackId;
    if (this.playbackFinishTimer) {
      clearTimeout(this.playbackFinishTimer);
      this.playbackFinishTimer = null;
    }
    for (const node of this.scheduledSources) {
      try {
        node.stop();
        node.disconnect();
      } catch {
        // already ended
      }
    }
    this.scheduledSources.clear();
    if (report && playbackId) {
      this.sendControl({ type: "playback_cancelled", playbackId });
    }
    this.activePlaybackId = null;
    this.playbackStartedSent = false;
    this.playbackTime = 0;
  }

  private resumeAudio(): void {
    if (this.captureCtx?.state === "suspended") void this.captureCtx.resume();
    if (this.playbackCtx?.state === "suspended") void this.playbackCtx.resume();
  }

  private clearRecoveryTimers(): void {
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.captureRetryTimer) clearTimeout(this.captureRetryTimer);
    this.reconnectTimer = null;
    this.captureRetryTimer = null;
  }

  private teardownCapture(): void {
    try {
      this.worklet?.disconnect();
      this.source?.disconnect();
    } catch {
      // best effort
    }
    this.worklet = null;
    this.source = null;
    if (this.captureCtx) {
      void this.captureCtx.close();
      this.captureCtx = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.pending = [];
    this.resampleCarry = 0;
  }
}
