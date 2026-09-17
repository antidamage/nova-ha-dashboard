// Label tables for the readout format, unit and rounding pickers.
import type { OrbDisplayUnit, OrbInfoFormat, OrbRounding } from "../../../../lib/orb-info/types";

export const FORMAT_LABELS: Record<OrbInfoFormat, string> = {
  number: "Number",
  duration: "Duration",
  percent: "Percentage",
  clock: "Clock",
  temperature: "Temperature",
  text: "Text",
};

export const DURATION_UNITS: OrbDisplayUnit[] = ["auto", "seconds", "minutes", "hours", "days", "weeks"];
export const UNIT_LABELS: Partial<Record<OrbDisplayUnit, string>> = {
  auto: "Automatic",
  seconds: "Seconds",
  minutes: "Minutes",
  hours: "Hours",
  days: "Days",
  weeks: "Weeks",
  celsius: "Celsius",
  fahrenheit: "Fahrenheit",
  watts: "Watts",
  kilowatts: "Kilowatts",
};
export const ROUNDING_LABELS: Record<OrbRounding, string> = {
  floor: "Down",
  round: "Nearest",
  ceil: "Up",
};
