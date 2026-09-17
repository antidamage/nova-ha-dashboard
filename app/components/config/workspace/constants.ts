import { AudioLines, Blocks, Bot, Database, MonitorSmartphone, Palette } from "lucide-react";
import type { ConfigCategoryId } from "./types";

export const isDemoMode = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

// Signing out has to clear BOTH cookies, in this order. The outpost holds its
// own session cookie alongside authentik's; hitting the outpost's sign_out
// endpoint redirects straight back to /start, which would silently re-issue a
// session from the still-valid authentik cookie. So clear the outpost cookie
// with a fetch whose redirect we deliberately do not follow, then navigate to
// authentik's invalidation flow to end the SSO session itself.
// `dashboard-invalidation` rather than authentik's default invalidation flow:
// it is the same user_logout stage followed by a static redirect stage back to
// the dashboard front page, so signing out lands where you started instead of
// on authentik's own "you have been logged out" page. The flow executor's
// `?next=` argument cannot do this — it rejects absolute URLs, and authentik is
// served on :9443 while the dashboard is on :443.
export const AUTHENTIK_INVALIDATION_URL = "https://nova.tuatara-dory.ts.net:9443/if/flow/dashboard-invalidation/";

export const CONFIG_CATEGORIES: Array<{
  id: ConfigCategoryId;
  label: string;
  detail: string;
  icon: typeof Bot;
}> = [
  { id: "assistant", label: "Assistant", detail: "Identity, runtime and authority", icon: Bot },
  { id: "voice-people", label: "Voice & People", detail: "Speech, satellites and household voices", icon: AudioLines },
  { id: "appearance-dashboard", label: "Appearance & Dashboard", detail: "Theme, status and interaction", icon: Palette },
  { id: "devices", label: "Devices", detail: "Computers, camera and hardware", icon: MonitorSmartphone },
  { id: "modules", label: "Modules", detail: "Installed extensions and their settings", icon: Blocks },
  { id: "system-data", label: "System & Data", detail: "Secrets, transfer, updates and power", icon: Database },
];

// Legacy-link translation only, now — the URL's own source of truth is the
// path (see parseConfigPath/CONFIG_PATH_PREFIX below). This map still covers
// bookmarks and hard-coded links from before the breadcrumb path existed
// (UpdateBanner's /config#updates, chiefly), translated once on initial load.
export const HASH_CATEGORY: Record<string, ConfigCategoryId> = {
  agent: "assistant",
  assistant: "assistant",
  authority: "assistant",
  identity: "assistant",
  voice: "voice-people",
  "voice-infrastructure": "voice-people",
  "voice-people": "voice-people",
  "user-data": "voice-people",
  appearance: "appearance-dashboard",
  "appearance-dashboard": "appearance-dashboard",
  "status-orb-info": "appearance-dashboard",
  reminders: "appearance-dashboard",
  climate: "appearance-dashboard",
  "appletv-swipe": "appearance-dashboard",
  phonoscope: "appearance-dashboard",
  devices: "devices",
  "managed-computers": "devices",
  "hardware-assistant": "devices",
  camera: "devices",
  modules: "modules",
  module: "modules",
  extensions: "modules",
  "system-data": "system-data",
  secrets: "system-data",
  "config-transfer": "system-data",
  updates: "system-data",
  system: "system-data",
};

export const CONFIG_PATH_PREFIX = `${isDemoMode ? (process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH ?? "").replace(/\/$/, "") : ""}/config`;
