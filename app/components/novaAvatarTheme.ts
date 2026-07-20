"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DEFAULT_NOVA_AVATAR_THEME,
  normalizeGymAlertThresholdHours,
  normalizeNovaAvatarTheme,
  type NovaAvatarTheme,
} from "./avatarThemeModel";
import {
  loadSharedClientConfig,
  loadSharedConfig,
  readCachedClientConfig,
  saveSharedConfig,
  SHARED_CONFIG_CHANGE_EVENT,
  SHARED_CONFIG_STORAGE_KEY,
} from "./sharedConfigCache";
import { useSettingCooldown } from "./useSettingCooldown";

const CHANGE_EVENT = "nova-avatar-theme-change";
const SHARED_AVATAR_CONFIG_POLL_MS = 30 * 1000;

// Legacy-only bridge for the old dashboard.avatar path in /api/config. The
// embedded Status Orb editor uses the per-variant /api/theme flow instead.

function recordValue(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function avatarThemeFromConfig(value: unknown, fallback: Partial<NovaAvatarTheme> | null | undefined) {
  return normalizeNovaAvatarTheme(recordValue(recordValue(value)?.dashboard)?.avatar ?? fallback);
}

async function readSharedAvatarConfig(fallback: Partial<NovaAvatarTheme> | null | undefined) {
  return avatarThemeFromConfig(await loadSharedClientConfig(), fallback);
}

function configWithAvatar(config: unknown, avatar: NovaAvatarTheme) {
  const base = recordValue(config) ?? {};
  const dashboard = recordValue(base.dashboard) ?? {};
  return {
    ...base,
    dashboard: {
      ...dashboard,
      avatar: normalizeNovaAvatarTheme(avatar),
    },
  };
}

async function writeSharedAvatarConfig(theme: NovaAvatarTheme) {
  const currentPayload = await loadSharedConfig();
  const payload = await saveSharedConfig(configWithAvatar(currentPayload.config, theme));

  if (!payload.ok) {
    throw new Error((payload as { error?: string }).error ?? "Shared avatar config update failed");
  }
}

export function useLegacyNovaAvatarTheme(initialTheme?: Partial<NovaAvatarTheme> | null) {
  const [theme, setThemeState] = useState<NovaAvatarTheme>(() =>
    avatarThemeFromConfig(readCachedClientConfig(), initialTheme ?? DEFAULT_NOVA_AVATAR_THEME));
  // Hold off the 30s poll while an avatar colour/value is being edited so an
  // in-flight fetch can't rubber-band it back.
  const { isCoolingDown, markInteraction } = useSettingCooldown();

  const loadTheme = useCallback(async (options: { background?: boolean } = {}) => {
    if (options.background && isCoolingDown()) {
      return;
    }
    try {
      const nextTheme = await readSharedAvatarConfig(initialTheme ?? DEFAULT_NOVA_AVATAR_THEME);
      // A background poll whose fetch was already in flight when the user started
      // editing must not clobber the in-progress change.
      if (options.background && isCoolingDown()) {
        return;
      }
      setThemeState(nextTheme);
    } catch (error) {
      console.error("[nova-dashboard] failed to load Nova avatar config", error);
    }
  }, [initialTheme, isCoolingDown]);

  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key && event.key !== SHARED_CONFIG_STORAGE_KEY) {
        return;
      }
      void loadTheme();
    };
    const onAvatarChange = (event: Event) => {
      const nextTheme = (event as CustomEvent<NovaAvatarTheme>).detail;
      if (nextTheme) {
        setThemeState(normalizeNovaAvatarTheme(nextTheme));
        return;
      }
      void loadTheme();
    };
    const onSharedConfigChange = () => {
      setThemeState(avatarThemeFromConfig(readCachedClientConfig(), initialTheme ?? DEFAULT_NOVA_AVATAR_THEME));
    };

    void loadTheme();
    window.addEventListener("storage", onStorage);
    window.addEventListener(CHANGE_EVENT, onAvatarChange);
    window.addEventListener(SHARED_CONFIG_CHANGE_EVENT, onSharedConfigChange);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener(CHANGE_EVENT, onAvatarChange);
      window.removeEventListener(SHARED_CONFIG_CHANGE_EVENT, onSharedConfigChange);
    };
  }, [initialTheme, loadTheme]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void loadTheme({ background: true });
    }, SHARED_AVATAR_CONFIG_POLL_MS);

    return () => window.clearInterval(interval);
  }, [loadTheme]);

  const setTheme = useCallback((next: NovaAvatarTheme) => {
    markInteraction();
    const normalized = normalizeNovaAvatarTheme(next);
    setThemeState(normalized);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: normalized }));

    void writeSharedAvatarConfig(normalized).catch((error) => {
      console.error("[nova-dashboard] failed to update shared Nova avatar config", error);
    });
  }, [markInteraction]);

  const previewTheme = useCallback((next: NovaAvatarTheme) => {
    const normalized = normalizeNovaAvatarTheme(next);
    setThemeState(normalized);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: normalized }));
  }, []);

  const resetTheme = useCallback(() => {
    markInteraction();
    setThemeState(DEFAULT_NOVA_AVATAR_THEME);
    window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: DEFAULT_NOVA_AVATAR_THEME }));
    void writeSharedAvatarConfig(DEFAULT_NOVA_AVATAR_THEME).catch((error) => {
      console.error("[nova-dashboard] failed to reset shared Nova avatar config", error);
    });
  }, [markInteraction]);

  return { theme, setTheme, previewTheme, resetTheme };
}

export {
  DEFAULT_NOVA_AVATAR_THEME,
  normalizeGymAlertThresholdHours,
  normalizeNovaAvatarTheme,
  type NovaAvatarTheme,
};
