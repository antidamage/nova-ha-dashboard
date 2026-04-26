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
    <html lang="en">
      <head>
        <script
          dangerouslySetInnerHTML={{
            __html: `
try {
  document.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  var themeKey = "nova.dashboard.accent.v1";
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
  var storedText = localStorage.getItem(themeKey);
  var cookieText = cookieValue(themeKey);
  var stored = JSON.parse(storedText || (cookieText ? decodeURIComponent(cookieText) : "null") || "null");
  var accent = stored && stored.accent ? stored.accent : (stored && Array.isArray(stored.rgb) ? stored : null);
  var highlight = stored && stored.highlight ? stored.highlight : null;
  var background = stored && stored.background ? stored.background : null;
  var border = stored && stored.border ? stored.border : null;
  var map = stored && stored.map ? stored.map : null;
  var radarOpacity = stored && stored.radarOpacity;
  var radarPaletteMode = stored && stored.radarPaletteMode === "custom" ? "custom" : "spectrum";
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
  if (stored) {
    document.cookie = themeKey + "=" + encodeURIComponent(JSON.stringify(stored)) + "; Path=/; Max-Age=31536000; SameSite=Lax";
    var accentRgb = applied(accent, [215, 255, 50]);
    var highlightRgb = applied(highlight, [40, 243, 255]);
    var backgroundRgb = applied(background, [37, 39, 40]);
    setRgb("line", accentRgb);
    setRgb("cyan", highlightRgb);
    setBorder(border, accentRgb);
    setBackground(backgroundRgb);
    setTitleTone(titleTone, accentRgb, highlightRgb, backgroundRgb);
    setMap(map);
    setRadarOpacity(radarOpacity);
  }
} catch (_) {}
`,
          }}
        />
      </head>
      <body>
        <NovaAvatar size={150} />
        {children}
      </body>
    </html>
  );
}
