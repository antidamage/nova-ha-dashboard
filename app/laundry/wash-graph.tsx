import { watts as formatWatts } from "./bill-format";
import { wattsAxis, type WashDetailSample } from "../../lib/power/wash-detail";

/**
 * One wash's own power, drawn from every sample the meter kept
 * (specs/power-meters.md §5.3).
 *
 * **This is the detailed graph, not the panel's block.** A block on the panel's
 * card carries 48 points because that is what fits across a card (§5.2); this
 * sheet is the run's own detail, so it draws the trace as the meter wrote it —
 * hundreds of points for a normal wash — and says how many it drew.
 *
 * A document's figure, so it is ink on paper: the curve is the bill's own black
 * and the rules are its greys. The one background in it is the average's own
 * plate, which the print sheet asks for explicitly (`print-color-adjust`,
 * laundry-print.css), because the curve runs under that label and a figure has to
 * stay readable on paper. The plot is SVG scaled to its box, with the axis labels
 * as text around it so they keep a readable size on a phone; the numbers are in
 * the caption as words, which is also what a screen reader gets.
 */
export function WashGraph({
  averageWatts,
  durationLabel,
  durationSeconds,
  endLabel,
  peakAtSeconds,
  peakWatts,
  samples,
  startLabel,
}: {
  averageWatts: number;
  durationLabel: string;
  /** The run's own length, which the time axis is scaled to (§5.3). */
  durationSeconds: number;
  endLabel: string;
  peakAtSeconds: number;
  peakWatts: number;
  samples: WashDetailSample[];
  startLabel: string;
}) {
  if (samples.length < 2) {
    // Two samples are the fewest that draw a line. One is not none, so the figure
    // states the one reading it holds rather than saying nothing was kept.
    return (
      <p className="laundry-graph-empty">
        {samples.length === 0
          ? "The meter kept no samples for this wash."
          : `The meter kept one sample for this wash, at ${formatWatts(samples[0][1])} — too few to draw a curve.`}
      </p>
    );
  }
  const { step, top } = wattsAxis(peakWatts);
  const width = 1000;
  const height = 100;
  // Scaled to the RUN's own length, not to the samples' extent: a trace that
  // stops short of the end leaves a gap on the axis rather than claiming a span it
  // does not cover, and the times under the plot are the ones it is drawn against.
  const span = durationSeconds > 0 ? durationSeconds : 1;
  const x = (seconds: number) => Math.round((seconds / span) * width);
  const y = (value: number) => Math.round(height - Math.min(1, Math.max(0, value / top)) * height);
  const minutes = Math.floor(peakAtSeconds / 60);

  return (
    <figure className="laundry-graph">
      <div className="laundry-graph-body">
        <div className="laundry-graph-yscale" aria-hidden="true">
          {[3, 2, 1, 0].map((multiple) => (
            <span key={multiple} style={{ top: `${(1 - multiple / 3) * 100}%` }}>
              {multiple === 0 ? "0" : formatWatts(step * multiple)}
            </span>
          ))}
        </div>
        <div className="laundry-graph-plot">
          <svg
            className="laundry-graph-rules"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            {[1, 2, 3].map((multiple) => (
              <line key={multiple} x1={0} x2={width} y1={y(step * multiple)} y2={y(step * multiple)} />
            ))}
            <line className="is-average" x1={0} x2={width} y1={y(averageWatts)} y2={y(averageWatts)} />
          </svg>
          <svg
            className="laundry-graph-curve"
            viewBox={`0 0 ${width} ${height}`}
            preserveAspectRatio="none"
            aria-hidden="true"
          >
            <polyline points={samples.map(([seconds, value]) => `${x(seconds)},${y(value)}`).join(" ")} />
          </svg>
          <span className="laundry-graph-average" style={{ top: `${(y(averageWatts) / height) * 100}%` }}>
            averaged {formatWatts(averageWatts)}
          </span>
        </div>
      </div>

      <div className="laundry-graph-time" aria-hidden="true">
        <span>{startLabel}</span>
        <span>{endLabel}</span>
      </div>

      {/* The figure in words: what a reader takes from the picture, and the only
          part of it a screen reader or a printed page of numbers can carry. */}
      <figcaption className="laundry-note">
        This run's own watts, as the meter kept them: {samples.length} samples over {durationLabel}, peaking at{" "}
        {formatWatts(peakWatts)}
        {minutes >= 1 ? ` ${minutes} minutes in` : ""}. The dashed rule is the draw it averaged.
      </figcaption>
    </figure>
  );
}
