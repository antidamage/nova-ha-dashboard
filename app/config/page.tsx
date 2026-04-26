import { cookies } from "next/headers";
import { AccentConfig } from "../components/AccentConfig";
import { NovaAvatarConfig } from "../components/NovaAvatarConfig";
import type { DeviceTheme, ThemeColorValue } from "../components/accentColor";

const THEME_COOKIE_NAME = "nova.dashboard.accent.v1";

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
  const initialTheme = readInitialTheme(cookieStore.get(THEME_COOKIE_NAME)?.value);

  return (
    <>
      <AccentConfig initialTheme={initialTheme} />
      <NovaAvatarConfig />
    </>
  );
}
