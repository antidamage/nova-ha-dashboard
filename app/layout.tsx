import type { Metadata } from "next";
import "./globals.css";
import NovaAvatar from "./components/NovaAvatar";

export const metadata: Metadata = {
  title: "Nova Control",
  description: "Zone-based Home Assistant controls for Nova",
  icons: {
    icon: "/favicon.ico",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  document.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  var themeKey = "nova.dashboard.accent.v1";
  var themeScopeKey = "nova.dashboard.configScope.v1";
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
  var storedText = themeScope === "shared" ? null : localStorage.getItem(themeKey);
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
  var radarPaletteMode = stored && stored.radarPaletteMode === "custom" ? "custom" : "spectrum";
  var taskGlowIntensity = stored && stored.taskGlowIntensity;
  var mapSatellite = !(stored && stored.mapSatellite === false);
  var titleTone = stored && stored.titleTone ? stored.titleTone : "auto";
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
    if (!Number.isFinite(parsed)) return 100;
    return clamp(Math.round(parsed), 0, 100);
  };
  var normalizedMapLabelSize = function (value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return 100;
    return clamp(Math.round(parsed), 50, 200);
  };
  var normalizedMapBuildingOpacity = function (value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return 38;
    return clamp(Math.round(parsed), 0, 100);
  };
  var normalizedTaskGlowIntensity = function (value) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return 200;
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
  var titleColor = function (tone, rgb, allowOverride) {
    if (!allowOverride) return luminance(rgb) > 0.5 ? "var(--cyber-title-dark)" : "var(--cyber-title-light)";
    if (tone === "dark") return "var(--cyber-title-dark)";
    if (tone === "light") return "var(--cyber-title-light)";
    return luminance(rgb) > 0.5 ? "var(--cyber-title-dark)" : "var(--cyber-title-light)";
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
    var enabled = borderValue && borderValue.enabled === true;
    var rgb = enabled ? applied(borderValue.color, [215, 255, 50]) : fallbackRgb;
    var opacity = enabled ? clamp(Math.round(Number(borderValue.opacity !== undefined ? borderValue.opacity : 36)), 0, 100) / 100 : 0.36;
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
  var setTitleTone = function (tone, accentRgb, highlightRgb, backgroundRgb) {
    document.documentElement.style.setProperty("--cyber-title-on-line", titleColor(tone, accentRgb, false));
    document.documentElement.style.setProperty("--cyber-title-on-cyan", titleColor(tone, highlightRgb, false));
    document.documentElement.style.setProperty("--cyber-title-on-highlight", titleColor(tone, highlightRgb, false));
    document.documentElement.style.setProperty("--cyber-title-on-bg", titleColor(tone, backgroundRgb, true));
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
    setMapColor("base", mapValue && mapValue.base, [37, 39, 40]);
    setMapColor("water", waterValue, [191, 232, 255]);
    setMapColor("land", mapValue && mapValue.land, [30, 32, 32]);
    setMapColor("building-low", mapValue && (mapValue.buildingLow || mapValue.buildings), [215, 255, 50]);
    setMapColor("building-high", buildingHighValue, [255, 255, 255]);
    setMapColor("roads", mapValue && (mapValue.roads || mapValue.majorRoads || mapValue.minorRoads), [215, 255, 50]);
    setMapColor("labels", mapValue && mapValue.labels, [215, 255, 50]);
    setMapColor("radar-low", mapValue && mapValue.radarLow, [40, 243, 255]);
    setMapColor("radar-high", mapValue && mapValue.radarHigh, [255, 255, 255]);
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
    document.documentElement.style.setProperty("--cyber-map-water-opacity", String(normalizedRadarOpacity(value && value.opacity)));
  };
  var applyTheme = function (themeValue) {
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
    var radarPaletteMode = themeValue.radarPaletteMode === "custom" ? "custom" : "spectrum";
    var taskGlowIntensity = themeValue.taskGlowIntensity;
    var mapSatellite = !(themeValue.mapSatellite === false);
    var titleTone = themeValue.titleTone ? themeValue.titleTone : "auto";
    document.cookie = themeKey + "=" + encodeURIComponent(JSON.stringify(themeValue)) + "; Path=/; Max-Age=31536000; SameSite=Lax";
    var accentRgb = applied(accent, [215, 255, 50]);
    var highlightRgb = applied(highlight, [40, 243, 255]);
    var backgroundRgb = applied(background, [37, 39, 40]);
    setRgb("line", accentRgb);
    setRgb("cyan", highlightRgb);
    setBorder(border, accentRgb);
    setBackground(backgroundRgb);
    setTitleTone(titleTone, accentRgb, highlightRgb, backgroundRgb);
    setMap(map);
    document.documentElement.style.setProperty("--cyber-map-radar-mode", radarPaletteMode);
    setMapBuildingOpacity(mapBuildingOpacity);
    setMapLabelSize(mapLabelSize);
    setMapWater(mapWater);
    setRadarOpacity(radarOpacity);
    setTaskGlowIntensity(taskGlowIntensity);
    document.documentElement.style.setProperty("--cyber-map-satellite", mapSatellite ? "1" : "0");
  };
  if (stored) {
    applyTheme(stored);
  }
  if (themeScope === "shared") {
    fetch("/api/theme", { cache: "no-store" })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (data && data.theme) applyTheme(data.theme);
      })
      .catch(function () {});
  }
} catch (_) {}
`,
          }}
        />
      </head>
      <body>
        <NovaAvatar size={200} />
        {children}
      </body>
    </html>
  );
}
