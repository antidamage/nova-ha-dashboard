import { cookies } from "next/headers";
import { readDashboardConfig, readDefaultDashboardConfig } from "../../lib/dashboard-config";
import { readDashboardPreferences } from "../../lib/preferences";
import { themeResponseValue } from "../../lib/theme-values";
import { AccentConfig } from "../components/AccentConfig";
import { AgentNameConfig } from "../components/AgentNameConfig";
import { AppleTvSwipeConfig } from "../components/AppleTvSwipeConfig";
import { ConfigWorkspace } from "../components/ConfigWorkspace";
import { DashboardClimateConfig } from "../components/DashboardClimateConfig";
import { GymCounterConfig } from "../components/GymCounterConfig";
import { ManagedComputersConfig } from "../components/ManagedComputersConfig";
import { UpdateConfig } from "../components/UpdateConfig";
import { WaveshareWatchfaceConfig } from "../components/WaveshareWatchfaceConfig";
import { VoiceConfig } from "../components/VoiceConfig";
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
  const initialWatchface = configScope === "shared" ? preferences?.watchface ?? null : null;

  return (
    <ConfigWorkspace
      updateSection={
        <UpdateConfig initialAutoUpdate={preferences?.update?.autoUpdate ?? dashboardConfig.update.autoUpdate} />
      }
    >
      <AgentNameConfig />
      <AccentConfig
        initialTheme={initialTheme}
      />
      <VoiceConfig initialSettings={sharedPreferences?.voice ?? null} />
      <GymCounterConfig initialSettings={initialWatchface} />
      <DashboardClimateConfig initialSettings={dashboardConfig.dashboard.aircon} />
      <ManagedComputersConfig />
      <AppleTvSwipeConfig initialSettings={preferences?.layout?.swipe ?? null} />
      <WaveshareWatchfaceConfig initialSettings={initialWatchface} />
    </ConfigWorkspace>
  );
}
