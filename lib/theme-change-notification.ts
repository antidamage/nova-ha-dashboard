import { readDashboardSecrets } from "./dashboard-secrets";

/**
 * Tell a phone the theme's wallpaper changed.
 *
 * The dashboard cannot push to iOS, so this posts to a user-configured
 * notification webhook (Pushcut, in this house) whose notification runs a
 * Shortcut that fetches `/api/desktop/wallpapers/current/wallpaper.png`. The
 * URL is a secret and lives only in `data/dashboard-secrets.json` on the host,
 * never in the repo.
 *
 * Firing is the wallpaper sync's business: it happens on the same explicit
 * triggers (leaving config, a dark/light flip while the dashboard is open, the
 * manual Apply button) and only when the wallpaper a phone would fetch has
 * actually changed since the last notification.
 */

// Where a phone should fetch the wallpaper from. A sync can run with no
// request to take an origin from - a timer, or the dashboard flipping variant
// - so this comes from the host's environment. It has no default: the address
// a house reaches its dashboard on is household configuration and must not be
// a literal in this source (SPEC.md §2). With none set, the notification still
// fires and simply carries no fetch URL.
const PUBLIC_BASE_URL = (process.env.NOVA_PUBLIC_BASE_URL ?? "").trim().replace(/\/$/, "");

const REQUEST_TIMEOUT_MS = 10_000;

export type ThemeChangeNotificationResult = {
  error?: string;
  ok: boolean;
  sent: boolean;
  skipped?: "not-configured" | "unchanged";
};

export function wallpaperFetchUrl(orientation: "landscape" | "portrait" = "portrait"): string | null {
  if (!PUBLIC_BASE_URL) {
    return null;
  }
  const suffix = orientation === "landscape" ? "?orientation=landscape" : "";
  return `${PUBLIC_BASE_URL}/api/desktop/wallpapers/current/wallpaper.png${suffix}`;
}

export async function sendThemeChangeNotification(input: {
  assetId: string;
  variant: "dark" | "light";
}): Promise<ThemeChangeNotificationResult> {
  const { themeChangeNotificationUrl } = await readDashboardSecrets();
  if (!themeChangeNotificationUrl) {
    return { ok: true, sent: false, skipped: "not-configured" };
  }

  const fetchUrl = wallpaperFetchUrl();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(themeChangeNotificationUrl, {
      body: JSON.stringify({
        // Pushcut passes `input` through to the Shortcut the notification
        // runs, so the phone is told where to fetch rather than having the
        // address baked into the Shortcut.
        ...(fetchUrl ? { input: fetchUrl } : {}),
        text: `${input.variant === "light" ? "Light" : "Dark"} wallpaper`,
        title: "Nova theme change",
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
      signal: controller.signal,
    });
    if (!response.ok) {
      return {
        error: `Notification webhook returned ${response.status}`,
        ok: false,
        sent: false,
      };
    }
    return { ok: true, sent: true };
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : "Notification webhook failed",
      ok: false,
      sent: false,
    };
  } finally {
    clearTimeout(timer);
  }
}
