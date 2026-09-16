"use client";

import { normalizeNovaAvatarTheme } from "../theme-model/theme-model";
import { DEFAULT_NOVA_AVATAR_THEME } from "../theme-model/constants";
import { useLegacyNovaAvatarTheme } from "../../novaAvatarTheme";
import { NovaAvatarConfigView } from "./NovaAvatarConfigView";
import type { NovaAvatarConfigProps } from "./types";

function LegacyStandaloneNovaAvatarConfig({ initialTheme }: Pick<NovaAvatarConfigProps, "initialTheme">) {
  const shared = useLegacyNovaAvatarTheme(initialTheme);
  return (
    <NovaAvatarConfigView
      embedded={false}
      theme={shared.theme}
      onThemeChange={shared.setTheme}
      onThemePreview={shared.previewTheme}
    />
  );
}

export function NovaAvatarConfig({
  embedded = false,
  initialTheme,
  onThemeChange,
  onThemePreview,
  theme: controlledTheme,
}: NovaAvatarConfigProps) {
  if (!embedded && controlledTheme === undefined && onThemeChange === undefined) {
    return <LegacyStandaloneNovaAvatarConfig initialTheme={initialTheme} />;
  }

  return (
    <NovaAvatarConfigView
      embedded={embedded}
      theme={normalizeNovaAvatarTheme(controlledTheme ?? initialTheme ?? DEFAULT_NOVA_AVATAR_THEME)}
      onThemeChange={onThemeChange}
      onThemePreview={onThemePreview}
    />
  );
}
