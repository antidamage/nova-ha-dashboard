import { cookies } from "next/headers";
import { readDashboardConfig, readDefaultDashboardConfig } from "../../lib/dashboard-config";
import { getLatestDashboardSun } from "../../lib/dashboard-events";
import { readDashboardPreferences } from "../../lib/preferences";
import { themeResponseValue } from "../../lib/theme-values";
import { ConfigWorkspace } from "../components/ConfigWorkspace";
import type { ThemeStorageValue } from "../components/accentColor";

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

export default async function ConfigPage() {
  const demoMode = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
  const cookieStore = demoMode ? null : await cookies();
  const dashboardConfig = demoMode ? await readDefaultDashboardConfig() : await readDashboardConfig();
  const localTheme = readInitialTheme(cookieStore?.get(THEME_COOKIE_NAME)?.value);
  const configScope = cookieStore?.get(THEME_SCOPE_COOKIE_NAME)?.value === "local" ? "local" : "shared";
  const sharedPreferences = !demoMode ? await readDashboardPreferences() : null;
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
      initialAircon={dashboardConfig.dashboard.aircon}
      initialAutoUpdate={preferences?.update?.autoUpdate ?? dashboardConfig.update.autoUpdate}
      initialSwipe={preferences?.layout?.swipe ?? null}
      initialSun={initialSun}
      initialTheme={initialTheme}
      initialVoiceSettings={sharedPreferences?.voice ?? null}
      initialWatchface={initialWatchface}
    />
  );
}
