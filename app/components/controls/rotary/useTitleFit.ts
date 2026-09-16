"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ELLIPSIS } from "./constants";
import { captionFont, titleRoom } from "./geometry-model";
import type { RingGeometry, RotaryEncoderRing } from "./types";

/** Cuts the title arc's text with "..." to fit the arc. */
export function useTitleFit(
  title: string | undefined,
  titleClassName: string | undefined,
  dialSize: number,
  geometry: RingGeometry,
  shown: RotaryEncoderRing[],
) {
  const titleFont = captionFont(dialSize);
  const titleSvgRef = useRef<SVGSVGElement | null>(null);
  const [titleFitted, setTitleFitted] = useState(title ?? "");
  useLayoutEffect(() => {
    const svg = titleSvgRef.current;
    if (!title || !svg) {
      setTitleFitted(title ?? "");
      return;
    }
    // Measured on a throwaway <text> carrying the title's own class and size,
    // the way the ring labels are, and never on the node React owns.
    const probe = document.createElementNS("http://www.w3.org/2000/svg", "text");
    probe.setAttribute("class", ["rotary-encoder-title", titleClassName].filter(Boolean).join(" "));
    probe.setAttribute("font-size", String(titleFont));
    probe.setAttribute("visibility", "hidden");
    svg.appendChild(probe);
    const room = titleRoom(geometry);
    const fits = (text: string) => {
      probe.textContent = text;
      // jsdom lays nothing out; there, everything fits.
      return typeof probe.getComputedTextLength !== "function" || probe.getComputedTextLength() <= room;
    };
    let next = title;
    if (!fits(title)) {
      next = ELLIPSIS;
      for (let keep = title.length - 1; keep > 0; keep -= 1) {
        const cut = `${title.slice(0, keep).trimEnd()}${ELLIPSIS}`;
        if (fits(cut)) {
          next = cut;
          break;
        }
      }
    }
    probe.remove();
    setTitleFitted(next);
    // geometry derives from dialSize and the ring count alone.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, titleClassName, titleFont, dialSize, shown.length]);
  return { titleFont, titleSvgRef, titleFitted };
}
