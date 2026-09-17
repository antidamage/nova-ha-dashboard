// Image header sniffing: PNG, JPEG and WebP dimensions, alpha and format, from
// the bytes alone.

/**
 * PNG, sniffed from the signature rather than trusted from the upload's
 * declared type — the same rule `app/api/background-texture/route.ts` follows.
 *
 * Colour types 4 and 6 carry an alpha channel outright; type 3 is a palette,
 * which is transparent only if a tRNS chunk says so. An opaque PNG is accepted
 * rather than rejected: it still works, it just covers a rectangle, and telling
 * someone their logo is "invalid" when it renders fine would be wrong. The flag
 * rides along so the editor can point it out.
 */
export function readPng(data: Buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (data.length < 26 || signature.some((byte, index) => data[index] !== byte)) return null;
  const colorType = data[25];
  const hasAlpha = colorType === 4 || colorType === 6
    || (colorType === 3 && data.includes(Buffer.from("tRNS", "ascii")));
  return { width: data.readUInt32BE(16), height: data.readUInt32BE(20), hasAlpha };
}

/**
 * JPEG, by walking the marker chain to the frame header.
 *
 * There is no fixed offset to read: a JPEG is a sequence of length-prefixed
 * segments and the dimensions live in whichever SOFn marker the encoder chose.
 * So the segments are skipped in order until one turns up. Never transparent —
 * the format has no alpha channel at all.
 *
 * `SOF4` (0xC4) is the Huffman table, `SOF8` (0xC8) is reserved and `SOFC`
 * (0xCC) is arithmetic coding: all three sit inside the 0xC0-0xCF range without
 * being frame headers, which is why they are excluded rather than the range
 * being taken wholesale.
 */
function readJpeg(data: Buffer) {
  if (data.length < 4 || data[0] !== 0xff || data[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < data.length) {
    if (data[offset] !== 0xff) {
      // Fill bytes are legal padding between segments; anything else means the
      // chain has desynchronised and there is nothing trustworthy left to read.
      offset += 1;
      continue;
    }
    const marker = data[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    // Start of scan: entropy-coded data from here on, so a frame header that
    // has not turned up by now is not going to.
    if (marker === 0xda || marker === 0xd9) return null;
    const length = data.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (marker >= 0xc0 && marker <= 0xcf
        && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return {
        height: data.readUInt16BE(offset + 5),
        width: data.readUInt16BE(offset + 7),
        hasAlpha: false,
      };
    }
    offset += 2 + length;
  }
  return null;
}

/**
 * WebP, in all three of its shapes.
 *
 * A RIFF container whose payload is one of `VP8 ` (lossy), `VP8L` (lossless) or
 * `VP8X` (extended). The dimensions are packed differently in each, and only
 * the last two can carry alpha — `VP8X` says so with a flag bit, `VP8L` with
 * its own header bit, and plain `VP8 ` never can.
 */
function readWebp(data: Buffer) {
  if (data.length < 30) return null;
  if (data.toString("ascii", 0, 4) !== "RIFF" || data.toString("ascii", 8, 12) !== "WEBP") {
    return null;
  }
  const chunk = data.toString("ascii", 12, 16);
  if (chunk === "VP8X") {
    // 24-bit little-endian, and stored as one less than the real size.
    const width = 1 + (data[24] | (data[25] << 8) | (data[26] << 16));
    const height = 1 + (data[27] | (data[28] << 8) | (data[29] << 16));
    return { width, height, hasAlpha: (data[20] & 0x10) !== 0 };
  }
  if (chunk === "VP8L") {
    // 14 bits each, packed across four bytes after the 0x2f signature byte.
    if (data[20] !== 0x2f) return null;
    const bits = data.readUInt32LE(21);
    return {
      width: 1 + (bits & 0x3fff),
      height: 1 + ((bits >> 14) & 0x3fff),
      hasAlpha: ((data[24] >> 4) & 0x08) !== 0,
    };
  }
  if (chunk === "VP8 ") {
    // The keyframe header, after the 3-byte frame tag and the 3-byte sync code.
    if (data[23] !== 0x9d || data[24] !== 0x01 || data[25] !== 0x2a) return null;
    return {
      width: data.readUInt16LE(26) & 0x3fff,
      height: data.readUInt16LE(28) & 0x3fff,
      hasAlpha: false,
    };
  }
  return null;
}

/**
 * Dimensions, transparency and format, from the bytes alone.
 *
 * Every branch sniffs a signature rather than believing the upload's declared
 * MIME type, because the declared type is attacker-controlled and the extension
 * this writes to disk is derived from the answer.
 */
export function readImageHeader(data: Buffer) {
  const png = readPng(data);
  if (png) return { ...png, format: "png" as const };
  const jpeg = readJpeg(data);
  if (jpeg) return { ...jpeg, format: "jpeg" as const };
  const webp = readWebp(data);
  if (webp) return { ...webp, format: "webp" as const };
  return null;
}
