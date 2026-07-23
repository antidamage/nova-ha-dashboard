import type { Metadata } from "next";
import "./globals.css";
import { DemoTooltipLayer } from "./components/DemoTooltipLayer";
import { ExperienceModeModal } from "./components/ExperienceModeModal";
import { AgentNameProvider } from "./components/AgentNameContext";
import NovaAvatar from "./components/NovaAvatar";
import BrowserVoiceSatellite from "./components/dashboard/BrowserVoiceSatellite";
import { SystemActivityBlocker } from "./components/SystemActivityBlocker";
import { SmoothScrollController } from "./components/SmoothScrollController";
import { TouchClickGuard } from "./components/TouchClickGuard";
import { demoConfigBootstrapScript } from "../lib/demo-config";
import { getLatestDashboardSun } from "../lib/dashboard-events";
import { readDashboardConfig, readDefaultDashboardConfig } from "../lib/dashboard-config";
import { readDashboardPreferences } from "../lib/preferences";
import { themeResponseValue } from "../lib/theme-values";
import { normalizeVoiceSettings, VOICE_SETTINGS_DEFAULTS } from "../lib/voice-settings";
import type { ThemeStorageValue } from "./components/accentColor";
import {
  DEFAULT_CLOCK_FONT_ID,
  DEFAULT_THEME_FONT_ID,
  googleFontsHref,
  themeFontStackMap,
} from "./components/themeFonts";
import demoThemeDefault from "../config/demo-theme.default.json";
import demoThemeLibraryDefault from "../config/demo-theme-library.default.json";

const isDemoMode = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const demoBasePath = process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH?.trim().replace(/\/+$/, "") ?? "";
const appleTouchIconSizes = [57, 60, 72, 76, 114, 120, 144, 152, 167, 180] as const;

function publicAssetPath(path: string) {
  return isDemoMode && demoBasePath ? `${demoBasePath}${path}` : path;
}

// The demo default theme references public assets (e.g. the perturbation
// texture) with root-relative paths. When the demo is served under a base path
// (GitHub Pages: /nova-ha-dashboard), those assets live under that prefix, so we
// rewrite the texture URLs to match before injecting the theme.
function demoThemeWithAssetPaths<T>(theme: T): T {
  if (!isDemoMode || !demoBasePath) {
    return theme;
  }

  const clone = JSON.parse(JSON.stringify(theme)) as {
    theme?: { themes?: Record<string, { backgroundEffect?: { textureUrl?: string | null } }> };
  };
  const variants = clone.theme?.themes;
  if (variants) {
    for (const variant of Object.values(variants)) {
      const textureUrl = variant?.backgroundEffect?.textureUrl;
      if (typeof textureUrl === "string" && textureUrl.startsWith("/")) {
        variant.backgroundEffect!.textureUrl = publicAssetPath(textureUrl);
      }
    }
  }
  return clone as T;
}

// Same asset-path rewrite as above, but for every saved entry in the demo theme
// library so a theme selected from the library renders its texture correctly.
function demoThemeLibraryWithAssetPaths<T>(library: T): T {
  if (!isDemoMode || !demoBasePath) {
    return library;
  }

  const clone = JSON.parse(JSON.stringify(library)) as {
    entries?: Array<{ themeSet?: { themes?: Record<string, { backgroundEffect?: { textureUrl?: string | null } }> } }>;
  };
  for (const entry of clone.entries ?? []) {
    const variants = entry?.themeSet?.themes;
    if (!variants) {
      continue;
    }
    for (const variant of Object.values(variants)) {
      const textureUrl = variant?.backgroundEffect?.textureUrl;
      if (typeof textureUrl === "string" && textureUrl.startsWith("/")) {
        variant.backgroundEffect!.textureUrl = publicAssetPath(textureUrl);
      }
    }
  }
  return clone as T;
}

// Resolve the saved shared theme on the server so the status orb canvas can
// paint the correct colours on its first frame. This mirrors exactly what
// GET /api/theme returns (per-variant avatar, with the legacy global avatar as
// fallback); the orb otherwise has no synchronous source and flashes the
// compiled-in default until the client-side /api/theme fetch lands. Demo mode
// serves the theme through a client-side fetch shim, so it stays null here.
async function readInitialOrbTheme(): Promise<ThemeStorageValue | null> {
  if (isDemoMode) {
    return null;
  }

  try {
    const [preferences, config] = await Promise.all([
      readDashboardPreferences(),
      readDashboardConfig(),
    ]);
    return themeResponseValue(preferences.theme, config.dashboard.avatar) as ThemeStorageValue | null;
  } catch {
    // Fall back to the client's existing cache/default path on any read error.
    return null;
  }
}

async function readInitialAgentName(): Promise<string> {
  if (isDemoMode) {
    return VOICE_SETTINGS_DEFAULTS.agentName;
  }
  try {
    return normalizeVoiceSettings((await readDashboardPreferences()).voice).agentName;
  } catch {
    return VOICE_SETTINGS_DEFAULTS.agentName;
  }
}

// Where the Outside camera stream is embedded FROM. Capture now lives on
// Nocturnium; nova is a pure consumer. Seed the
// configured host onto the client so CameraPanel/CameraConfig embed the stream
// directly (see app/components/dashboard/cameraHost.ts). Empty = same-origin
// fallback.
export async function generateMetadata(): Promise<Metadata> {
  const agentName = await readInitialAgentName();
  return {
    title: `${agentName} Control`,
    description: `Zone-based Home Assistant controls for ${agentName}`,
    icons: {
      icon: publicAssetPath("/favicon.ico"),
      apple: [
        ...appleTouchIconSizes.map((size) => ({
          url: publicAssetPath(`/apple-touch-icon-${size}x${size}.png`),
          sizes: `${size}x${size}`,
          type: "image/png",
        })),
        { url: publicAssetPath("/apple-touch-icon.png"), sizes: "180x180", type: "image/png" },
      ],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const demoMode = isDemoMode;
  const [initialOrbTheme, initialAgentName] = await Promise.all([
    readInitialOrbTheme(),
    readInitialAgentName(),
  ]);
  // Real sun status (from the event poller's last state build) so an "auto"
  // theme selection resolves the correct dark/light variant on the very first
  // paint. Without it, both the head bootstrap and the SSR'd orb text fall
  // back to an hour-of-day guess evaluated on the SERVER clock — wrong for
  // most of the local day when the container runs in UTC. Null before the
  // poller has produced a state (fresh boot) and in demo mode.
  const initialSun = demoMode ? null : getLatestDashboardSun();
  const serverSunJson = JSON.stringify(initialSun ?? null).replace(/</g, "\\u003c");
  const demoProviderBase = process.env.NEXT_PUBLIC_NOVA_DEMO_PROVIDER_BASE ?? "https://example.github.io/nova-dummy-data-provider/";
  const demoBootstrapScript = demoMode
    ? demoConfigBootstrapScript(
        await readDefaultDashboardConfig(),
        demoProviderBase,
        demoThemeWithAssetPaths(demoThemeDefault),
        demoThemeLibraryWithAssetPaths(demoThemeLibraryDefault),
      )
    : null;

  // id -> CSS font stack, injected into the head bootstrap so the saved theme/clock
  // fonts are seeded on the first paint (no flash of the compiled-in default).
  const fontStacksJson = JSON.stringify(themeFontStackMap());

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={googleFontsHref()} />
        {demoMode ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `try {${demoBootstrapScript}} catch (_) {}`,
            }}
          />
        ) : null}
        {demoMode ? (
          <script dangerouslySetInnerHTML={{ __html: "window.__NOVA_VIDEO_HOST__=\"\";" }} />
        ) : (
          // A separate no-store route is intentional: the root layout is
          // prerendered, while videoHostUrl is mutable shared runtime config.
          // This parser-blocking script resolves the current host before any
          // camera client code hydrates.
          <script src="/api/camera/bootstrap" />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  document.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  // Per-device experience mode (mirrors experienceModeSetting.ts): flag lite
  // devices before first paint so the CSS kill-switch and orb suppression in
  // globals.css apply from the very first frame, before React hydrates. The
  // stored value is "rich" (all features on), "lite" (all off), or a JSON
  // {statusOrb,background,camera,worldMap} object for mixed states.
  var experienceRaw = localStorage.getItem("nova.dashboard.experienceMode.v1");
  var experienceOrbOn = true;
  var experienceLite = false;
  if (experienceRaw === "lite") {
    experienceLite = true;
    experienceOrbOn = false;
  } else if (experienceRaw && experienceRaw.charAt(0) === "{") {
    try {
      var experienceFeatures = JSON.parse(experienceRaw);
      experienceOrbOn = experienceFeatures.statusOrb !== false;
      experienceLite =
        experienceFeatures.statusOrb === false &&
        experienceFeatures.background === false &&
        experienceFeatures.camera === false &&
        experienceFeatures.worldMap === false;
    } catch (_) {}
  }
  document.documentElement.toggleAttribute("data-nova-lite", experienceLite);
  document.documentElement.toggleAttribute("data-nova-no-orb", !experienceOrbOn);
  document.documentElement.toggleAttribute(
    "data-nova-hide-orb-info",
    localStorage.getItem("nova.dashboard.statusOrbInfo.v1") === "false"
  );

  var themeKey = "nova.dashboard.accent.v1";
  var sharedThemeKey = "nova.dashboard.sharedAccent.v1";
  var themeScopeKey = "nova.dashboard.configScope.v1";
  var serverSun = ${serverSunJson};
  var cookieValue = function (name) {
    var parts = document.cookie ? document.cookie.split("; ") : [];
    for (var index = 0; index < parts.length; index += 1) {
      var item = parts[index];
      var splitAt = item.indexOf("=");
      var key = splitAt >= 0 ? item.slice(0, splitAt) : item;
      if (key === name) return splitAt >= 0 ? item.slice(splitAt + 1) : "";
    }
    return null;
  };
  var explicitThemeScope = localStorage.getItem(themeScopeKey) || cookieValue(themeScopeKey);
  var themeScope = explicitThemeScope === "local" ? "local" : "shared";
  document.cookie = themeScopeKey + "=" + themeScope + "; Path=/; Max-Age=31536000; SameSite=Lax";
  var storedText = themeScope === "shared" ? localStorage.getItem(sharedThemeKey) : localStorage.getItem(themeKey);
  var cookieText = cookieValue(themeKey);
  var stored = JSON.parse(storedText || (cookieText ? decodeURIComponent(cookieText) : "null") || "null");
  var accent = stored && stored.accent ? stored.accent : (stored && Array.isArray(stored.rgb) ? stored : null);
  var highlight = stored && stored.highlight ? stored.highlight : null;
  var background = stored && stored.background ? stored.background : null;
  var border = stored && stored.border ? stored.border : null;
  var map = stored && stored.map ? stored.map : null;
  var mapBuildingOpacity = stored && stored.mapBuildingOpacity;
  var mapLabelSize = stored && stored.mapLabelSize;
  var mapWater = stored && stored.mapWater ? stored.mapWater : null;
  var radarOpacity = stored && stored.radarOpacity;
  var radarPaletteMode = stored && stored.radarPaletteMode === "spectrum" ? "spectrum" : "custom";
  var taskGlowIntensity = stored && stored.taskGlowIntensity;
  var mapSatellite = !(stored && stored.mapSatellite === false);
  var titleTone = stored && stored.titleTone ? stored.titleTone : "auto";
  var titleColors = stored && stored.titleColors ? stored.titleColors : null;
  var fontStacks = ${fontStacksJson};
  var defaultFontId = "${DEFAULT_THEME_FONT_ID}";
  var defaultClockFontId = "${DEFAULT_CLOCK_FONT_ID}";
  var fontSlot = function (slot, setting, fallbackId, fallbackWeight) {
    var id = setting && typeof setting === "object" ? setting.id : setting;
    var weight = setting && typeof setting === "object" && setting.weight ? setting.weight : fallbackWeight;
    var offset = setting && typeof setting === "object" && setting.sizeOffset !== undefined ? Number(setting.sizeOffset) : 0;
    if (!isFinite(offset)) offset = 0;
    offset = clamp(Math.round(offset), -5, 5);
    var stack = (id && fontStacks[id]) || fontStacks[fallbackId];
    var root = document.documentElement.style;
    if (stack) root.setProperty("--cyber-" + slot, stack);
    root.setProperty("--cyber-" + slot + "-weight", String(weight || fallbackWeight));
    root.setProperty("--cyber-" + slot + "-scale", (1 + offset * 0.04).toFixed(3));
  };
  var clamp = function (value, min, max) {
    return Math.max(min, Math.min(max, value));
  };
  var applied = function (color, fallbackRgb) {
    var rawRgb = color && Array.isArray(color.rgb) ? color.rgb : fallbackRgb;
    var intensity = clamp(Math.round(Number(color && color.intensity !== undefined ? color.intensity : 100)), 0, 100) / 100;
    return rawRgb.slice(0, 3).map(function (part) {
      return clamp(Math.round(Number(part) * intensity), 0, 255);
    });
  };
  var matchesColor = function (color, rgb, intensity) {
    if (!color || !Array.isArray(color.rgb)) return false;
    var colorIntensity = clamp(Math.round(Number(color.intensity !== undefined ? color.intensity : 100)), 0, 100);
    return colorIntensity === intensity &&
      Math.round(Number(color.rgb[0])) === rgb[0] &&
      Math.round(Number(color.rgb[1])) === rgb[1] &&
      Math.round(Number(color.rgb[2])) === rgb[2];
  };
  var normalizedRadarOpacity = function (value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return 87;
    return clamp(Math.round(parsed), 0, 100);
  };
  var normalizedMapWaterOpacity = function (value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return 10;
    return clamp(Math.round(parsed), 0, 100);
  };
  var normalizedMapLabelSize = function (value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return 150;
    return clamp(Math.round(parsed), 50, 200);
  };
  var normalizedMapBuildingOpacity = function (value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return 66;
    return clamp(Math.round(parsed), 0, 100);
  };
  var normalizedTaskGlowIntensity = function (value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return 100;
    return clamp(Math.round(parsed), 50, 300);
  };
  var mix = function (from, to, amount) {
    return [
      clamp(Math.round(from[0] + (to[0] - from[0]) * amount), 0, 255),
      clamp(Math.round(from[1] + (to[1] - from[1]) * amount), 0, 255),
      clamp(Math.round(from[2] + (to[2] - from[2]) * amount), 0, 255)
    ];
  };
  var rgbCss = function (rgb) {
    return "rgb(" + rgb[0] + " " + rgb[1] + " " + rgb[2] + ")";
  };
  var luminance = function (rgb) {
    return (0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]) / 255;
  };
  var titleColorSlot = function (tone, rgb, allowOverride) {
    if (!allowOverride) return luminance(rgb) > 0.5 ? "dark" : "light";
    if (tone === "dark") return "dark";
    if (tone === "light") return "light";
    return luminance(rgb) > 0.5 ? "dark" : "light";
  };
  var titleColor = function (tone, rgb, allowOverride) {
    return "var(--cyber-title-" + titleColorSlot(tone, rgb, allowOverride) + ")";
  };
  var setRgb = function (name, rgb) {
    var value = rgb[0] + " " + rgb[1] + " " + rgb[2];
    if (name === "line") {
      document.documentElement.style.setProperty("--foreground", "rgb(" + value + ")");
      document.documentElement.style.setProperty("--cyber-line", "rgb(" + value + ")");
      document.documentElement.style.setProperty("--cyber-line-rgb", value);
      document.documentElement.style.setProperty("--cyber-line-dim", "rgb(" + value + " / 0.36)");
      return;
    }
    document.documentElement.style.setProperty("--cyber-cyan", "rgb(" + value + ")");
    document.documentElement.style.setProperty("--cyber-cyan-rgb", value);
    document.documentElement.style.setProperty("--cyber-highlight", "rgb(" + value + ")");
    document.documentElement.style.setProperty("--cyber-highlight-rgb", value);
  };
  var setBorder = function (borderValue, fallbackRgb) {
    var enabled = borderValue && borderValue.enabled !== undefined ? borderValue.enabled === true : true;
    var rgb = enabled ? applied(borderValue && borderValue.color, [255, 255, 255]) : fallbackRgb;
    var opacity = enabled ? clamp(Math.round(Number(borderValue && borderValue.opacity !== undefined ? borderValue.opacity : 19)), 0, 100) / 100 : 0.36;
    var value = rgb[0] + " " + rgb[1] + " " + rgb[2];
    document.documentElement.style.setProperty("--cyber-border-rgb", value);
    document.documentElement.style.setProperty("--cyber-border-dim", "rgb(" + value + " / " + opacity + ")");
    document.documentElement.style.setProperty("--cyber-border-strong", "rgb(" + value + " / " + Math.min(1, opacity + 0.54) + ")");
  };
  var setBackground = function (rgb) {
    document.documentElement.style.setProperty("--background", rgbCss(rgb));
    document.documentElement.style.setProperty("--cyber-bg", rgbCss(rgb));
    document.documentElement.style.setProperty("--cyber-panel", rgbCss(mix(rgb, [0, 0, 0], 0.16)));
    document.documentElement.style.setProperty("--cyber-panel-soft", rgbCss(mix(rgb, [255, 255, 255], 0.07)));
  };
  var setTitleTone = function (tone, accentRgb, highlightRgb, backgroundRgb, colors) {
    document.documentElement.style.setProperty("--cyber-title-on-line", titleColor(tone, accentRgb, false));
    document.documentElement.style.setProperty("--cyber-title-on-cyan", titleColor(tone, highlightRgb, false));
    document.documentElement.style.setProperty("--cyber-title-on-highlight", titleColor(tone, highlightRgb, false));
    var clockTextFill = titleColor(tone, backgroundRgb, true);
    document.documentElement.style.setProperty("--cyber-title-on-bg", clockTextFill);
    document.documentElement.style.setProperty("--cyber-clock-text-fill", clockTextFill);
    var titleSlot = titleColorSlot(tone, backgroundRgb, true);
    var clockFill = titleSlot === "dark" ? applied(colors && colors.dark, [42, 0, 61]) : applied(colors && colors.light, [173, 173, 173]);
    document.documentElement.style.setProperty("--cyber-title-on-clock-fill", titleColor("auto", clockFill, false));
  };
  var setTitleColors = function (colors) {
    var dark = applied(colors && colors.dark, [42, 0, 61]);
    var light = applied(colors && colors.light, [173, 173, 173]);
    document.documentElement.style.setProperty("--cyber-title-dark", rgbCss(dark));
    document.documentElement.style.setProperty("--cyber-title-light", rgbCss(light));
  };
  var setMapColor = function (name, color, fallbackRgb) {
    var rgb = applied(color, fallbackRgb);
    var value = rgb[0] + " " + rgb[1] + " " + rgb[2];
    document.documentElement.style.setProperty("--cyber-map-" + name, "rgb(" + value + ")");
    document.documentElement.style.setProperty("--cyber-map-" + name + "-rgb", value);
  };
  var setMap = function (mapValue) {
    var waterValue = mapValue && matchesColor(mapValue.water, [217, 233, 242], 12) ? null : mapValue && mapValue.water;
    var buildingHighValue = mapValue && matchesColor(mapValue.buildingHigh, [40, 243, 255], 100) ? null : mapValue && mapValue.buildingHigh;
    setMapColor("base", mapValue && mapValue.base, [26, 26, 26]);
    setMapColor("water", waterValue, [140, 0, 255]);
    setMapColor("land", mapValue && mapValue.land, [30, 32, 32]);
    setMapColor("building-low", mapValue && (mapValue.buildingLow || mapValue.buildings), [72, 0, 161]);
    setMapColor("building-high", buildingHighValue, [115, 0, 255]);
    setMapColor("roads", mapValue && (mapValue.roads || mapValue.majorRoads || mapValue.minorRoads), [177, 154, 223]);
    setMapColor("labels", mapValue && mapValue.labels, [168, 168, 168]);
    setMapColor("radar-low", mapValue && mapValue.radarLow, [255, 242, 0]);
    setMapColor("radar-high", mapValue && mapValue.radarHigh, [106, 255, 0]);
    document.documentElement.style.setProperty("--cyber-map-radar-mode", radarPaletteMode);
  };
  var setRadarOpacity = function (value) {
    document.documentElement.style.setProperty("--cyber-map-radar-opacity", String(normalizedRadarOpacity(value)));
  };
  var setTaskGlowIntensity = function (value) {
    var intensity = normalizedTaskGlowIntensity(value);
    var scale = intensity / 100;
    document.documentElement.style.setProperty("--task-glow-intensity", String(intensity));
    document.documentElement.style.setProperty("--task-glow-cyan-blur", Math.round(128 * scale) + "px");
    document.documentElement.style.setProperty("--task-glow-cyan-spread", Math.round(42 * scale) + "px");
    document.documentElement.style.setProperty("--task-glow-line-blur", Math.round(72 * scale) + "px");
    document.documentElement.style.setProperty("--task-glow-line-spread", Math.round(18 * scale) + "px");
    document.documentElement.style.setProperty("--task-glow-cyan-alpha", Math.min(1, 0.7 * scale).toFixed(3));
    document.documentElement.style.setProperty("--task-glow-line-alpha", Math.min(1, 0.72 * scale).toFixed(3));
  };
  var setMapLabelSize = function (value) {
    document.documentElement.style.setProperty("--cyber-map-label-size", String(normalizedMapLabelSize(value)));
  };
  var setMapBuildingOpacity = function (value) {
    document.documentElement.style.setProperty("--cyber-map-building-opacity", String(normalizedMapBuildingOpacity(value)));
  };
  var setMapWater = function (value) {
    var enabled = !(value && value.enabled === false);
    document.documentElement.style.setProperty("--cyber-map-water-enabled", enabled ? "1" : "0");
    document.documentElement.style.setProperty("--cyber-map-water-opacity", String(normalizedMapWaterOpacity(value && value.opacity)));
  };
  var sunIsDark = function (sun) {
    if (sun && sun.state === "below_horizon") return true;
    if (sun && sun.state === "above_horizon") return false;
    var nextRising = Date.parse(String(sun && sun.nextRising || ""));
    var nextSetting = Date.parse(String(sun && sun.nextSetting || ""));
    if (Number.isFinite(nextRising) && Number.isFinite(nextSetting)) return nextRising < nextSetting;
    var hour = new Date().getHours();
    return hour < 6 || hour >= 18;
  };
  var resolveThemeValue = function (themeValue, sun) {
    if (!themeValue || !themeValue.themes) return themeValue;
    var selection = themeValue.selection === "light" || themeValue.selection === "auto" ? themeValue.selection : "dark";
    var variant = selection === "auto" ? (sunIsDark(sun) ? "dark" : "light") : selection;
    return themeValue.themes[variant] || themeValue.themes.dark || themeValue.themes.light || null;
  };
  var applyTheme = function (themeValue, sun) {
    if (!themeValue) return;
    var sourceThemeValue = themeValue;
    themeValue = resolveThemeValue(themeValue, sun);
    if (!themeValue) return;
    var accent = themeValue.accent ? themeValue.accent : (Array.isArray(themeValue.rgb) ? themeValue : null);
    var highlight = themeValue.highlight ? themeValue.highlight : null;
    var background = themeValue.background ? themeValue.background : null;
    var border = themeValue.border ? themeValue.border : null;
    var map = themeValue.map ? themeValue.map : null;
    var mapBuildingOpacity = themeValue.mapBuildingOpacity;
    var mapLabelSize = themeValue.mapLabelSize;
    var mapWater = themeValue.mapWater ? themeValue.mapWater : null;
    var radarOpacity = themeValue.radarOpacity;
    var radarPaletteMode = themeValue.radarPaletteMode === "spectrum" ? "spectrum" : "custom";
    var taskGlowIntensity = themeValue.taskGlowIntensity;
    var mapSatellite = !(themeValue.mapSatellite === false);
    var titleTone = themeValue.titleTone ? themeValue.titleTone : "auto";
    var titleColors = themeValue.titleColors ? themeValue.titleColors : null;
    document.cookie = themeKey + "=" + encodeURIComponent(JSON.stringify(sourceThemeValue)) + "; Path=/; Max-Age=31536000; SameSite=Lax";
    localStorage.setItem(themeScope === "shared" ? sharedThemeKey : themeKey, JSON.stringify(sourceThemeValue));
    var accentRgb = applied(accent, [51, 51, 51]);
    var highlightRgb = applied(highlight, [75, 0, 117]);
    var backgroundRgb = applied(background, [26, 26, 26]);
    setRgb("line", accentRgb);
    setRgb("cyan", highlightRgb);
    setBorder(border, accentRgb);
    setBackground(backgroundRgb);
    setTitleColors(titleColors);
    setTitleTone(titleTone, accentRgb, highlightRgb, backgroundRgb, titleColors);
    setMap(map);
    document.documentElement.style.setProperty("--cyber-map-radar-mode", radarPaletteMode);
    setMapBuildingOpacity(mapBuildingOpacity);
    setMapLabelSize(mapLabelSize);
    setMapWater(mapWater);
    setRadarOpacity(radarOpacity);
    setTaskGlowIntensity(taskGlowIntensity);
    fontSlot("display", themeValue.font, defaultFontId, 500);
    fontSlot("clock", themeValue.clockFont, defaultClockFontId, 900);
    fontSlot("gym", themeValue.gymFont, defaultFontId, 500);
    document.documentElement.style.setProperty("--cyber-map-satellite", mapSatellite ? "1" : "0");
  };
  if (stored) {
    applyTheme(stored, serverSun);
  }
  if (themeScope === "shared") {
    fetch("/api/theme", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || !data.theme) return;
        if (data.theme.selection === "auto" && data.theme.themes) {
          fetch("/api/state", { cache: "no-store" })
            .then(function (response) { return response.ok ? response.json() : null; })
            .then(function (stateData) { applyTheme(data.theme, (stateData && stateData.sun) || serverSun); })
            .catch(function () { applyTheme(data.theme, serverSun); });
          return;
        }
        applyTheme(data.theme, serverSun);
      })
      .catch(function () {});
  }
} catch (_) {}
`,
          }}
        />
      </head>
      <body>
        <AgentNameProvider initialName={initialAgentName}>
          <TouchClickGuard />
          <SmoothScrollController />
          <ExperienceModeModal />
          <NovaAvatar size={200} initialTheme={initialOrbTheme} initialSun={initialSun} />
          <BrowserVoiceSatellite />
          <DemoTooltipLayer />
          <SystemActivityBlocker />
          {children}
        </AgentNameProvider>
      </body>
    </html>
  );
}
