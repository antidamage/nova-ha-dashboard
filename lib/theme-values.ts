import { sharedThemeValue } from "./api/dashboard-requests";

const DEFAULT_THEME_SELECTION = "dark";

function recordValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export function hasThemeNamespace(value: Record<string, unknown>) {
  const themes = value.themes;
  return Boolean(themes && typeof themes === "object" && !Array.isArray(themes));
}

function avatarWithFallback(avatarValue: unknown, avatarFallback: unknown) {
  const avatar = recordValue(avatarValue);

  // A per-variant avatar is authoritative: its own values (and only its own
  // values) skin that theme's status orb. We deliberately do NOT merge the
  // single global `dashboard.avatar` into a present avatar. Doing so made
  // every theme inherit one global gym number colour, so picking different
  // themes appeared to "swap" the gym colour or show another theme's colour.
  // Any field a theme omits is filled with the per-field default by the
  // client/orb normalisers — never by another theme's colours.
  if (avatar) {
    return avatar;
  }

  // Legacy compatibility only: a theme stored before per-variant avatars
  // existed has no avatar object at all. Seed that one case from the old
  // global avatar so those dashboards keep their previous look.
  return recordValue(avatarFallback) ?? avatarValue;
}

function themeWithAvatarFallback(theme: Record<string, unknown>, avatarFallback: unknown) {
  if (!avatarFallback) {
    return theme;
  }

  return {
    ...theme,
    avatar: avatarWithFallback(theme.avatar, avatarFallback),
  };
}

export function themeResponseValue(value: unknown, avatarFallback?: unknown) {
  const theme = sharedThemeValue(value);
  if (!theme) {
    return null;
  }
  if (hasThemeNamespace(theme)) {
    const themes = recordValue(theme.themes) ?? {};
    return {
      ...theme,
      themes: {
        ...themes,
        dark: themeWithAvatarFallback(recordValue(themes.dark) ?? {}, avatarFallback),
        light: themeWithAvatarFallback(recordValue(themes.light) ?? {}, avatarFallback),
      },
    };
  }

  const legacyTheme = themeWithAvatarFallback(theme, avatarFallback);
  return {
    selection: DEFAULT_THEME_SELECTION,
    themes: {
      dark: legacyTheme,
      light: legacyTheme,
    },
  };
}

export function mergeLegacyThemeUpdate(currentTheme: Record<string, unknown>, nextTheme: Record<string, unknown>) {
  if (!hasThemeNamespace(currentTheme)) {
    return {
      ...currentTheme,
      ...nextTheme,
    };
  }

  const themes = recordValue(currentTheme.themes) ?? {};
  return {
    ...currentTheme,
    themes: {
      ...themes,
      dark: {
        ...(recordValue(themes.dark) ?? {}),
        ...nextTheme,
      },
      light: {
        ...(recordValue(themes.light) ?? {}),
        ...nextTheme,
      },
    },
  };
}
