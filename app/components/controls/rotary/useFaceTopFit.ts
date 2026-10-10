"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ELLIPSIS } from "./constants";
import { setFaceTextContent } from "./faceText";

/**
 * Cuts the knob face's top text with "..." to fit its max-width. `decimals`
 * measures it with its decimal part at half size, as it will print.
 */
export function useFaceTopFit(faceTop: string | undefined, faceTopClassName: string | undefined, dialSize: number, decimals = false) {
  const dialRef = useRef<HTMLDivElement | null>(null);
  const [faceTopFitted, setFaceTopFitted] = useState(faceTop ?? "");
  useLayoutEffect(() => {
    const host = dialRef.current;
    if (!faceTop || !host) {
      setFaceTopFitted(faceTop ?? "");
      return;
    }
    const probe = document.createElement("span");
    probe.className = ["rotary-encoder-label", faceTopClassName].filter(Boolean).join(" ");
    probe.style.visibility = "hidden";
    probe.style.maxWidth = "none";
    host.appendChild(probe);
    const room = dialSize * 0.7;
    const fits = (text: string) => {
      setFaceTextContent(probe, text, decimals);
      // jsdom lays nothing out; there, everything fits.
      return probe.getBoundingClientRect().width <= room;
    };
    let next = faceTop;
    if (!fits(faceTop)) {
      next = ELLIPSIS;
      for (let keep = faceTop.length - 1; keep > 0; keep -= 1) {
        const cut = `${faceTop.slice(0, keep).trimEnd()}${ELLIPSIS}`;
        if (fits(cut)) {
          next = cut;
          break;
        }
      }
    }
    probe.remove();
    setFaceTopFitted(next);
  }, [faceTop, faceTopClassName, dialSize, decimals]);
  return { dialRef, faceTopFitted };
}
