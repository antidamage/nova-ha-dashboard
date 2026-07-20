// AudioWorklet capture processor for the browser voice satellite.
//
// Runs on the audio render thread and forwards raw mono microphone audio (the
// context's native sample rate, Float32) to the main thread in small blocks.
// Resampling to 16 kHz and NVAF framing happen on the main thread where the
// WebSocket lives (see browserSatellite.ts) — the worklet stays minimal so it
// never risks a glitch on the render thread.
class NovaVoiceCaptureProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const input = inputs[0];
    if (input && input[0] && input[0].length > 0) {
      // Copy: the underlying buffer is reused by the engine after process().
      this.port.postMessage(input[0].slice(0));
    }
    return true;
  }
}

registerProcessor("nova-voice-capture", NovaVoiceCaptureProcessor);
