// Black rectangles burned into the recording, each showing this host's own date
// and time. They cover clocks a capture source burns in when that clock is wrong.

import { existsSync } from "fs";

export type TimeBlock = { x: number; y: number; width: number; height: number; fontSize: number };

/** Parses "x,y,width,height,fontSize;..." in source pixels. A malformed entry is dropped. */
export function parseTimeBlocks(value: string): TimeBlock[] {
  return value
    .split(";")
    .map((entry) => entry.split(",").map((part) => Number(part.trim())))
    .filter((parts) => parts.length === 5 && parts.every(Number.isFinite) && parts[2] > 0 && parts[3] > 0 && parts[4] > 0)
    .map(([x, y, width, height, fontSize]) => ({ x, y, width, height, fontSize }));
}

/** A fixed-width face where one exists, so the digits hold still as the time changes. */
export function timeBlockFontFile(fallback: () => string | null): string | null {
  const mono = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf";
  return !process.env.NOVA_CAMERA_FONT?.trim() && existsSync(mono) ? mono : fallback();
}

/**
 * The ffmpeg filters for the blocks, which need frames in system memory. `fontFile`
 * is already escaped for a filtergraph; without one a block still hides the wrong
 * clock, it just has no text. The time is read per frame from the wall clock.
 */
export function timeBlockFilters(blocks: TimeBlock[], fontFile: string | null): string[] {
  return blocks.flatMap(({ x, y, width, height, fontSize }) => [
    `drawbox=x=${x}:y=${y}:w=${width}:h=${height}:color=black:t=fill`,
    ...(fontFile
      ? [
          `drawtext=fontfile='${fontFile}':fontcolor=white:fontsize=${fontSize}:` +
            `x=${x}+(${width}-text_w)/2:y=${y}+(${height}-text_h)/2:` +
            "text='%{localtime\\:%d/%m/%Y %H\\\\\\:%M\\\\\\:%S}'",
        ]
      : []),
  ]);
}
