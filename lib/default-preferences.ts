import { readFile } from "fs/promises";
import path from "path";
import type { DashboardPreferences } from "./types";

const DEFAULT_PREFERENCES_PATH =
  process.env.NOVA_DASHBOARD_DEFAULT_PREFERENCES ??
  path.join(process.cwd(), "config", "dashboard-preferences.default.json");
const DEFAULT_THEME_PATH = path.join(process.cwd(), "config", "demo-theme.default.json");
const DEFAULT_THEME_LIBRARY_PATH = path.join(process.cwd(), "config", "demo-theme-library.default.json");

export async function readDefaultDashboardPreferences(): Promise<DashboardPreferences> {
  try {
    const [preferencesText, themeText, themeLibraryText] = await Promise.all([
      readFile(DEFAULT_PREFERENCES_PATH, "utf8"),
      readFile(DEFAULT_THEME_PATH, "utf8"),
      readFile(DEFAULT_THEME_LIBRARY_PATH, "utf8"),
    ]);
    const preferences = JSON.parse(preferencesText) as DashboardPreferences;
    const themeEnvelope = JSON.parse(themeText) as { theme?: Record<string, unknown> };
    return {
      ...preferences,
      ...(themeEnvelope.theme ? { theme: themeEnvelope.theme } : {}),
      themeLibrary: JSON.parse(themeLibraryText) as Record<string, unknown>,
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      return {};
    }
    throw error;
  }
}
