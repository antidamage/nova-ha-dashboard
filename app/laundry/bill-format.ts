// How the laundry page writes its numbers (specs/power-meters.md §5.3). One
// place, so the bill, a wash's own sheet and the graph's axis agree to the digit.
//
// Deliberately not the dashboard's `power-format`: a bill prints plain figures,
// and the page's own files import no dashboard code at all.

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
