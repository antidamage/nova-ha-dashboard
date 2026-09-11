import { cookies } from "next/headers";
import { readDashboardConfig, readDefaultDashboardConfig } from "../../../lib/dashboard-config";
import { getLatestDashboardSun } from "../../../lib/dashboard-events";
import { readDefaultDashboardPreferences } from "../../../lib/default-preferences";
import { readDashboardPreferences } from "../../../lib/preferences";
import { themeResponseValue } from "../../../lib/theme-values";
import { ConfigWorkspace } from "../../components/ConfigWorkspace";
import type { ThemeStorageValue } from "../../components/accentColor";
import { configStaticSlugParams } from "../../components/configStaticTree";
import { demoDashboardConfig } from "../../../lib/demo-config";

const THEME_COOKIE_NAME = "nova.dashboard.accent.v1";
const THEME_SCOPE_COOKIE_NAME = "nova.dashboard.configScope.v1";

function readInitialTheme(value: string | undefined): ThemeStorageValue | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(decodeURIComponent(value)) as ThemeStorageValue;
  } catch {
    return undefined;
  }
}

// Optional catch-all so /config/<category>/<slug>* resolves server-side to
// this same page — the data-fetching below is unchanged from the old
// single-route /config; all path interpretation (which category, which
// accordion chain) happens client-side in ConfigWorkspace, reading
// window.location.pathname at mount exactly as it used to read the hash.
//
// generateStaticParams matters for the static-export demo build (output:
// "export" has no server-side fallback, so every path it doesn't list here
// 404s unless out/404.html's SPA-fallback catches it — see
// scripts/build-demo.mjs). On the live `next start` build this is harmless:
// dynamicParams defaults to true, so any path not listed here still renders
// on demand rather than 404ing.
export function generateStaticParams() {
  return configStaticSlugParams();
}

export default async function ConfigPage() {
  const demoMode = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
  const cookieStore = demoMode ? null : await cookies();
  const dashboardConfig = demoMode ? demoDashboardConfig(await readDefaultDashboardConfig()) : await readDashboardConfig();
  const localTheme = readInitialTheme(cookieStore?.get(THEME_COOKIE_NAME)?.value);
  const configScope = cookieStore?.get(THEME_SCOPE_COOKIE_NAME)?.value === "local" ? "local" : "shared";
  const sharedPreferences = demoMode
    ? await readDefaultDashboardPreferences()
    : await readDashboardPreferences();
  const preferences = configScope === "shared" ? sharedPreferences : null;
  const storedInitialTheme = configScope === "shared"
    ? (preferences?.theme as ThemeStorageValue | undefined) ?? localTheme
    : localTheme;
  const initialTheme = themeResponseValue(storedInitialTheme, dashboardConfig.dashboard.avatar) as ThemeStorageValue | null;
  const initialSun = demoMode ? null : getLatestDashboardSun();
  const initialWatchface = configScope === "shared" ? preferences?.watchface ?? null : null;

  return (
    <ConfigWorkspace
      initialAgentSettings={sharedPreferences?.agent ?? null}
      initialAutoUpdate={preferences?.update?.autoUpdate ?? dashboardConfig.update.autoUpdate}
      initialSwipe={preferences?.layout?.swipe ?? null}
      initialSun={initialSun}
      initialTheme={initialTheme}
      initialVoiceSettings={sharedPreferences?.voice ?? null}
      initialWatchface={initialWatchface}
    />
  );
}
