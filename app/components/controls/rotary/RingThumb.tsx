/**
 * One ring's thumb: a piece of its ring's annulus with a lighter crown, and the
 * LED line sunk along its centre (specs/color-encoder.md, "Arc, track, thumb,
 * label" and "The thumb's LED line"). Shape only; RotaryEncoder owns the input.
 */
import { THUMB_LED_LINE_PX } from "./constants";
import { arcPath } from "./geometry-model";
import { sectorPath } from "./thumb-model";
import { thumbHasGroove, thumbLedHalfAngle, type ThumbLed } from "./thumb-led-model";

export function RingThumb(props: {
  centre: number;
  radius: number;
  /** Where the thumb's centre is drawn, clockwise degrees from 12. */
  angle: number;
  length: number;
  thickness: number;
  led: ThumbLed;
  /** The track lip's gradient, which the groove's lip shares. */
  lipGradient: string;
}) {
  const { centre, radius, angle, length, thickness, led, lipGradient } = props;
  // A piece of the annulus, bending with its track and with radial ends, so
  // it never reads as a rotated pill (alex, 2026-10-24).
  const sector = (grow: number, across: number) =>
    sectorPath(centre, centre, radius, angle, length + grow, across, across * 0.3);
  const half = thumbLedHalfAngle(radius, length, thickness);
  const line = arcPath(centre, centre, radius, angle - half, angle + half);
  const groove = thumbHasGroove(thickness);
  return (
    <g className="rotary-encoder-thumb" data-led={led}>
      <path className="rotary-encoder-thumb-edge" d={sector(1, thickness + 1)} />
      <path className="rotary-encoder-thumb-body" d={sector(0, thickness)} />
      <path className="rotary-encoder-thumb-crown" d={sector(-thickness * 0.45, thickness * 0.55)} />
      {groove ? (
        <>
          <path className="rotary-encoder-thumb-groove-lip" d={line} strokeWidth={THUMB_LED_LINE_PX + 4} stroke={`url(#${lipGradient})`} />
          <path className="rotary-encoder-thumb-groove" d={line} strokeWidth={THUMB_LED_LINE_PX + 2} />
        </>
      ) : null}
      <path className="rotary-encoder-thumb-led" d={line} strokeWidth={THUMB_LED_LINE_PX} />
    </g>
  );
}
