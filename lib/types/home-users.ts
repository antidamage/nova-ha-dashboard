import type { HomeUserQuickAccessEntry, HomeZoneSetting } from "../config-schema/home-users";

/** A home user as the state payload carries them (specs/home-users.md). */
export type HomeUserState = {
  id: string;
  label: string;
  color: string;
  rooms: string[];
  showSystemTabs: boolean;
  quickAccess: HomeUserQuickAccessEntry[];
  nightMaxBrightnessPct: number;
  home: boolean;
  /** When `home` last changed; null when it never has. */
  changedAt: string | null;
};

export type { HomeUserQuickAccessEntry, HomeZoneSetting };
