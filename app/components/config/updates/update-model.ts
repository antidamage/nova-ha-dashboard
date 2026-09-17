// Poll cadence and the two formatters the Updates readout uses.

export const POLL_INTERVAL_MS = 30_000;

export function formatTime(value: string | null): string {
  if (!value) {
    return "never";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString();
}

export function shortSha(value: string | null): string {
  return value ? value.slice(0, 7) : "—";
}
