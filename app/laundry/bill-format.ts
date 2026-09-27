// How the laundry page writes its numbers (specs/power-meters.md §5.3). One
// place, so the bill, a wash's own sheet and the graph's axis agree to the digit.
//
// Deliberately not the dashboard's `power-format`: a bill prints plain figures,
// and the page's own files import no dashboard code at all.
import type { WashTemperature } from "../../lib/power";

/** Energy, to the precision a wash is worth: a spin is a few hundredths. */
export function kwh(value: number) {
  return `${value < 1 ? value.toFixed(3) : value.toFixed(2)} kWh`;
}

export function money(value: number) {
  return `$${value.toFixed(2)}`;
}

/** Watts: the graph's axis and its peak are whole watts. */
export function watts(value: number) {
  return `${Math.round(value)} W`;
}

/**
 * The temperature a wash ran at: the button that was pressed, `Cold` for a cycle
 * whose element never ran, and an em dash for one whose trace cannot say — which
 * is not the same thing as cold (§5.3).
 */
export function temperatureLabel(temperature: WashTemperature) {
  if (temperature.degrees !== null) {
    return `${temperature.degrees}°`;
  }
  return temperature.source === "cold" ? "Cold" : "—";
}

/** A heat-up's own length, to the second: eight minutes of element is its point. */
export function secondsLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return minutes >= 1 ? `${minutes}m ${rest}s` : `${rest}s`;
}
