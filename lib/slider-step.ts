/** Treat a decimal step as precision: 0.5 permits tenths, 0.05 hundredths. */
export function decimalStepGranularity(step: number) {
  const positive = Math.abs(step);
  if (!Number.isFinite(positive) || positive === 0 || Number.isInteger(positive)) return positive || 1;

  const [coefficient, exponentText] = positive.toString().toLowerCase().split("e");
  const coefficientDecimals = (coefficient.split(".")[1] ?? "").length;
  const decimalPlaces = Math.max(0, coefficientDecimals - Number(exponentText ?? 0));
  return 10 ** -decimalPlaces;
}
