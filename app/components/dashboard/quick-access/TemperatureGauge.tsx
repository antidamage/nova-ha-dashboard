import { gaugeFraction, gaugeFullCelsius } from "../../../../lib/host-temperatures/sources";

/**
 * One small ring gauge (specs/host-temperature-gauges.md): the geometry of
 * alex's Rainmeter CSM skin -- outer radius 50, inner 35 in a 120 box, so the
 * band is 30% of the radius -- filled clockwise from 6 o'clock (the bottom) against 100 C,
 * in the accent, with the reading in the middle. Read-only.
 */

const BOX = 120;
const OUTER = 50;
const INNER = 35;
const RADIUS = (OUTER + INNER) / 2;
const BAND = OUTER - INNER;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export function TemperatureGauge({
  label,
  part,
  celsius,
  dim,
  hot = false,
}: {
  label: string;
  /** "CPU", "GPU" or "GPU n": sets the ring's scale (gaugeFraction). */
  part: string;
  celsius: number | null;
  dim: boolean;
  /** Too hot (gaugeIsHot): the fill turns red and its glow pulses. */
  hot?: boolean;
}) {
  const fraction = gaugeFraction(part, celsius);
  const value = celsius === null ? "--" : `${celsius}°`;
  return (
    <div
      className={`quick-temp-gauge${dim ? " is-dim" : ""}${hot ? " is-hot" : ""}`}
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={Math.round(gaugeFullCelsius(part))}
      aria-valuenow={celsius ?? undefined}
      aria-valuetext={celsius === null ? "no reading" : `${celsius} degrees${hot ? ", too hot" : ""}`}
    >
      <div className="quick-temp-gauge-ring">
        <svg viewBox={`0 0 ${BOX} ${BOX}`} aria-hidden="true" focusable="false">
          <circle className="quick-temp-gauge-track" cx={BOX / 2} cy={BOX / 2} r={RADIUS} strokeWidth={BAND} />
          {fraction > 0 && (
            <circle
              className="quick-temp-gauge-fill"
              cx={BOX / 2}
              cy={BOX / 2}
              r={RADIUS}
              strokeWidth={BAND}
              strokeDasharray={`${fraction * CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              transform={`rotate(90 ${BOX / 2} ${BOX / 2})`}
            />
          )}
        </svg>
        <span className="quick-temp-gauge-value">{value}</span>
      </div>
      <span className="quick-stepper-caption quick-temp-gauge-caption">{label}</span>
    </div>
  );
}
