import { describe, expect, it } from "vitest";
import {
  NVAF_HEADER_SIZE,
  NVAF_KIND_AUDIO_INPUT,
  nvafFrameKind,
  nvafPayload,
  packNvafFrame,
} from "./nvaf";

// Wire-format contract against the Python reference
// (nova-voice/src/nova_voice/satellites/protocol.py, struct "!4sBBHQQI").
// A browser frame must be byte-identical to what AudioFrame.pack() produces, or
// the voice server rejects it — and that round trip can't be exercised offline,
// so this locks the exact header bytes here.
describe("NVAF framing", () => {
  it("packs the header exactly like the Python big-endian struct", () => {
    // Equivalent to: HEADER.pack(b"NVAF", 1, 1, 0, 42, 123456789, 4) + payload
    const payload = new Uint8Array([1, 2, 3, 4]);
    const frame = packNvafFrame(NVAF_KIND_AUDIO_INPUT, 0, 42, 123456789, payload);
    const bytes = Array.from(new Uint8Array(frame));

    expect(bytes).toEqual([
      0x4e, 0x56, 0x41, 0x46, // "NVAF"
      0x01, // version
      0x01, // kind = AUDIO_INPUT
      0x00, 0x00, // flags (u16 BE)
      0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a, // sequence 42 (u64 BE)
      0x00, 0x00, 0x00, 0x00, 0x07, 0x5b, 0xcd, 0x15, // monotonicNs 123456789 (u64 BE)
      0x00, 0x00, 0x00, 0x04, // payloadLen 4 (u32 BE)
      0x01, 0x02, 0x03, 0x04, // payload
    ]);
  });

  it("produces a 640-byte payload frame (20 ms @ 16 kHz int16) of 668 bytes total", () => {
    const frame = packNvafFrame(NVAF_KIND_AUDIO_INPUT, 0, 1, 0, new Uint8Array(640));
    expect(frame.byteLength).toBe(NVAF_HEADER_SIZE + 640);
  });

  it("round-trips kind and payload for reading server frames", () => {
    const payload = new Uint8Array([9, 8, 7, 6, 5]);
    const frame = packNvafFrame(2, 0, 7, 0, payload);
    expect(nvafFrameKind(frame)).toBe(2);
    expect(Array.from(new Uint8Array(nvafPayload(frame)))).toEqual([9, 8, 7, 6, 5]);
  });

  it("rejects a truncated buffer as having no readable kind", () => {
    expect(nvafFrameKind(new ArrayBuffer(10))).toBeNull();
  });
});
