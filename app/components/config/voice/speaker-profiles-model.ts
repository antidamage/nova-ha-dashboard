const identityDateFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

export const DEFAULT_SPEECH_PREFERENCES = {
  language: "Auto",
  speech_rate: 100,
  delivery_mode: "auto" as const,
  accessibility_pacing: false,
  pronunciations: {} as Record<string, string>,
};

export function relativeLastSeen(value: string, nowMs: number | null): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Last seen unknown";
  const absolute = identityDateFormatter.format(timestamp);
  if (nowMs === null) return `Last seen ${absolute}`;
  const elapsedSeconds = Math.max(0, Math.floor((nowMs - timestamp) / 1_000));
  let relative = "just now";
  if (elapsedSeconds >= 86_400) relative = `${Math.floor(elapsedSeconds / 86_400)}d ago`;
  else if (elapsedSeconds >= 3_600) relative = `${Math.floor(elapsedSeconds / 3_600)}h ago`;
  else if (elapsedSeconds >= 60) relative = `${Math.floor(elapsedSeconds / 60)}m ago`;
  return `Last seen ${absolute} (${relative})`;
}

export function timeToExpiry(value: string | null | undefined, nowMs: number | null): string {
  if (!value) return "Does not expire while associated";
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "Expiry unknown";
  if (nowMs === null) return `Expires ${identityDateFormatter.format(timestamp)}`;
  const remainingSeconds = Math.ceil((timestamp - nowMs) / 1_000);
  if (remainingSeconds <= 0) return "Expiry due";
  const days = Math.floor(remainingSeconds / 86_400);
  const hours = Math.floor((remainingSeconds % 86_400) / 3_600);
  const minutes = Math.max(1, Math.ceil((remainingSeconds % 3_600) / 60));
  if (days > 0) return `Expires in ${days}d ${hours}h`;
  if (hours > 0) return `Expires in ${hours}h ${minutes}m`;
  return `Expires in ${minutes}m`;
}
