// Environment compatibility overrides: the handful of settings that predate
// dashboard-config and are still read from the environment where an install
// sets them. Merged above every file layer, so they always win.

function listFromEnv(value: string | undefined) {
  return (value ?? "")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

function syncDaysFromEnv(value: string | undefined) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return undefined;
  }
  return Math.max(1, Math.min(60, Math.round(parsed)));
}

export function parseMapCenter(value: string | undefined) {
  const [latText, lngText] = (value ?? "").split(",").map((part) => part.trim());
  const lat = Number(latText);
  const lng = Number(lngText);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return undefined;
  }
  return { lat, lng };
}

export function envCompatibilityOverrides(): Record<string, unknown> {
  const center = parseMapCenter(process.env.NEXT_PUBLIC_MAP_CENTER);
  const calendars = listFromEnv(process.env.ICLOUD_CALENDARS);
  const reminders = listFromEnv(process.env.ICLOUD_REMINDERS);
  const syncDays = syncDaysFromEnv(process.env.ICLOUD_SYNC_DAYS);
  const novaAssistSatelliteEntityId = process.env.NOVA_ASSIST_SAT_ENTITY?.trim();

  return {
    ...(center ? { mapWeather: { center } } : {}),
    ...(novaAssistSatelliteEntityId
      ? { homeAssistant: { novaAssistSatelliteEntityId } }
      : {}),
    ...(calendars.length || reminders.length || syncDays
      ? {
          tasks: {
            iCloud: {
              ...(calendars.length ? { calendars } : {}),
              ...(reminders.length ? { reminders } : {}),
              ...(syncDays ? { defaultSyncDays: syncDays } : {}),
            },
          },
        }
      : {}),
  };
}
