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
};

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
  private stopped = false;

  constructor(
    private readonly url: string,
    private readonly hello: BrowserSatelliteHello,
    private readonly callbacks: BrowserSatelliteCallbacks = {},
  ) {}

  async start(): Promise<void> {
    this.stopped = false;
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });

    this.socket = new WebSocket(this.url);
    this.socket.binaryType = "arraybuffer";
    this.socket.addEventListener("open", () => this.sendHello());
    this.socket.addEventListener("message", (event) => this.onMessage(event));
    this.socket.addEventListener("close", (event) => {
      this.callbacks.onClose?.(event.reason || `code ${event.code}`);
      this.teardownAudio();
    });
    this.socket.addEventListener("error", (event) => this.callbacks.onError?.(event));

    await this.startCapture();
  }

  /** Push-to-talk: ask the server to treat the next segment as wake-initiated. */
  beginTurn(): void {
    this.sendControl({ type: "begin_turn" });
  }

  stop(): void {
    this.stopped = true;
    this.teardownAudio();
    if (this.socket && this.socket.readyState <= WebSocket.OPEN) {
      this.socket.close(1000, "client stop");
    }
    this.socket = null;
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
        playbackEvents: false,
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
        this.playbackSampleRate = Number(message.sampleRate) || TARGET_SAMPLE_RATE;
        this.playbackTime = 0;
        this.callbacks.onPlaybackStart?.();
        break;
      case "playback_done":
        this.callbacks.onPlaybackDone?.();
        break;
      case "playback_cancel":
        this.cancelPlayback();
        this.callbacks.onPlaybackDone?.();
        break;
      default:
        break;
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
    const now = ctx.currentTime;
    const startAt = Math.max(now, this.playbackTime);
    node.start(startAt);
    this.playbackTime = startAt + audioBuffer.duration;
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

  private cancelPlayback(): void {
    if (this.playbackCtx) {
      void this.playbackCtx.close();
      this.playbackCtx = null;
    }
    this.playbackTime = 0;
  }

  private teardownAudio(): void {
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
    this.cancelPlayback();
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    this.pending = [];
    this.resampleCarry = 0;
  }
}
