// NVAF wire-format framing, shared and pure (no browser globals) so it can be
// unit-tested against the Python reference layout in
// nova-voice/src/nova_voice/satellites/protocol.py.
//
// The 28-byte header is struct "!4sBBHQQI" (network / big-endian):
//   magic "NVAF" (4) | version (1) | kind (1) | flags (u16) |
//   sequence (u64) | monotonicNs (u64) | payloadLen (u32)
// followed by the payload. Audio payloads are little-endian int16 PCM (matches
// nova-voice/src/nova_voice/audio/pcm.py), independent of the big-endian header.

export const NVAF_MAGIC = [0x4e, 0x56, 0x41, 0x46] as const; // "NVAF"
export const NVAF_PROTOCOL_VERSION = 1;
export const NVAF_HEADER_SIZE = 28;

export const NVAF_KIND_AUDIO_INPUT = 1;
export const NVAF_KIND_AUDIO_OUTPUT = 2;
export const NVAF_KIND_CONTROL = 3;

export function packNvafFrame(
  kind: number,
  flags: number,
  sequence: number,
  monotonicNs: number,
  payload: Uint8Array,
): ArrayBuffer {
  const buffer = new ArrayBuffer(NVAF_HEADER_SIZE + payload.length);
  const view = new DataView(buffer);
  NVAF_MAGIC.forEach((byte, i) => view.setUint8(i, byte));
  view.setUint8(4, NVAF_PROTOCOL_VERSION);
  view.setUint8(5, kind);
  view.setUint16(6, flags); // big-endian (DataView default)
  view.setBigUint64(8, BigInt(sequence));
  view.setBigUint64(16, BigInt(Math.trunc(monotonicNs)));
  view.setUint32(24, payload.length);
  new Uint8Array(buffer, NVAF_HEADER_SIZE).set(payload);
  return buffer;
}

/** Frame kind byte, or null if the buffer is too short to be a valid header. */
export function nvafFrameKind(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < NVAF_HEADER_SIZE) return null;
  return new DataView(buffer).getUint8(5);
}

/** The payload slice, honouring the header's declared length. */
export function nvafPayload(buffer: ArrayBuffer): ArrayBuffer {
  const len = new DataView(buffer).getUint32(24);
  return buffer.slice(NVAF_HEADER_SIZE, NVAF_HEADER_SIZE + len);
}
