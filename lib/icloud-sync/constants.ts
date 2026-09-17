const ICLOUD_CALDAV_URL = "https://caldav.icloud.com";
export const DEFAULT_REMINDER_DURATION_MS = 30 * 60 * 1000;
const AUTH_BACKOFF_MS = 60 * 60 * 1000;
export const DEFAULT_DATE_ONLY_REMINDER_HOUR = 9;
export const TODO_FILTERS = [
  {
    "comp-filter": {
      _attributes: {
        name: "VCALENDAR",
      },
      "comp-filter": {
        _attributes: {
          name: "VTODO",
        },
      },
    },
  },
] as const;
