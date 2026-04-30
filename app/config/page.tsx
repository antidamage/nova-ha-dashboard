import { cookies } from "next/headers";
import { readDashboardPreferences } from "../../lib/preferences";
import { AccentConfig } from "../components/AccentConfig";
import { NovaAvatarConfig } from "../components/NovaAvatarConfig";
import type { DeviceTheme, ThemeColorValue } from "../components/accentColor";

const THEME_COOKIE_NAME = "nova.dashboard.accent.v1";
const THEME_SCOPE_COOKIE_NAME = "nova.dashboard.configScope.v1";

function readInitialTheme(value: string | undefined): Partial<DeviceTheme & ThemeColorValue> | undefined {
  if (!value) {
    return undefined;
  }

  try {
    return JSON.parse(decodeURIComponent(value)) as Partial<DeviceTheme & ThemeColorValue>;
  } catch {
    return undefined;
  }
}

export default async function ConfigPage() {
  const cookieStore = await cookies();
  const localTheme = readInitialTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);
  const configScope = cookieStore.get(THEME_SCOPE_COOKIE_NAME)?.value === "shared" ? "shared" : "local";
  const preferences = configScope === "shared" ? await readDashboardPreferences() : null;
  const initialTheme = configScope === "shared"
    ? (preferences?.theme as Partial<DeviceTheme & ThemeColorValue> | undefined) ?? localTheme
    : localTheme;

  return (
    <>
      <AccentConfig initialTheme={initialTheme} />
      <NovaAvatarConfig />
    </>
  );
}
