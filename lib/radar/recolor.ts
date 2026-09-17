import sharp from "sharp";
import { TILE_SIZE } from "./constants";
import { radarIntensityForPixel } from "./color-table";
import { mixColor } from "./tile-model";
import type { RadarFrame } from "./types";

export function radarTileUrl(frame: RadarFrame, z: number, x: number, y: number) {
  return `${frame.host}${frame.path}/${TILE_SIZE}/${z}/${x}/${y}/2/0_0.png`;
}

export async function recolorRadarTile(buffer: Uint8Array, lowColor: [number, number, number], highColor: [number, number, number]) {
  const image = sharp(buffer);
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });

  for (let offset = 0; offset < data.length; offset += info.channels) {
    const alpha = data[offset + 3];
    if (alpha === 0) {
      continue;
    }

    const intensity = radarIntensityForPixel(
      data[offset],
      data[offset + 1],
      data[offset + 2],
      alpha,
    );
    const [r, g, b] = mixColor(lowColor, highColor, intensity);
    data[offset] = r;
    data[offset + 1] = g;
    data[offset + 2] = b;
  }

  return sharp(data, {
    raw: {
      channels: info.channels,
      height: info.height,
      width: info.width,
    },
  })
    .png()
    .toBuffer()
    .then((nextBuffer) => new Uint8Array(nextBuffer));
}
