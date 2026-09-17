// The pre-hydration <head> bootstrap for app/layout.tsx: experience mode,
// iOS standalone flag, and the saved theme painted onto :root before React
// hydrates. The template text is emitted verbatim; the layout inlines the
// returned string as the last <head> script.
import { DEFAULT_CLOCK_FONT_ID, DEFAULT_THEME_FONT_ID } from "../components/themeFonts";

export function headBootstrapScript(serverSunJson: string, fontStacksJson: string): string {
  return `
try {
  // Launched from the iOS Home Screen? navigator.standalone is the iOS-only
  // signal for it, and is the input to the --nova-status-bar-clearance floor in
  // globals.css: in that mode iOS can report a 0 top safe-area inset while the
  // Dynamic Island still overlaps the page. Set before first paint so the page
  // never renders once at the wrong offset (specs/ios-home-screen-webapp.md).
  if (window.navigator.standalone === true) {
    document.documentElement.setAttribute("data-nova-ios-standalone", "true");
  }

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
  var clockColor = stored && stored.clockColor ? stored.clockColor : null;
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
  };
  // Mirrors applyCssPanel in app/components/theme/accent/apply-surfaces.ts; see specs/panel-surface.md.
  var setPanel = function (panelValue, backgroundRgb) {
    var rgb = panelValue && panelValue.color ? applied(panelValue.color, [26, 26, 26]) : mix(backgroundRgb, [0, 0, 0], 0.16);
    var alpha = clamp(Math.round(Number(panelValue && panelValue.opacity !== undefined ? panelValue.opacity : 100)), 0, 100) / 100;
    var soft = rgb.map(function (part) {
      return clamp(Math.round(part * (0.93 / 0.84) + 255 * 0.07), 0, 255);
    });
    document.documentElement.style.setProperty("--cyber-panel-rgb", rgb[0] + " " + rgb[1] + " " + rgb[2]);
    document.documentElement.style.setProperty("--cyber-panel", "rgb(" + rgb[0] + " " + rgb[1] + " " + rgb[2] + " / " + alpha + ")");
    document.documentElement.style.setProperty("--cyber-panel-soft", "rgb(" + soft[0] + " " + soft[1] + " " + soft[2] + " / " + alpha + ")");
  };
  var setTitleTone = function (tone, accentRgb, highlightRgb, backgroundRgb, clockColorValue, colors) {
    document.documentElement.style.setProperty("--cyber-title-on-line", titleColor(tone, accentRgb, false));
    document.documentElement.style.setProperty("--cyber-title-on-cyan", titleColor(tone, highlightRgb, false));
    document.documentElement.style.setProperty("--cyber-title-on-highlight", titleColor(tone, highlightRgb, false));
    var titleSlot = titleColorSlot(tone, backgroundRgb, true);
    var clockTextFill = titleColor(tone, backgroundRgb, true);
    document.documentElement.style.setProperty("--cyber-title-on-bg", clockTextFill);
    document.documentElement.style.setProperty("--cyber-clock-text-fill", clockTextFill);
    var fallbackClockColor = titleSlot === "dark" ? applied(colors && colors.dark, [42, 0, 61]) : applied(colors && colors.light, [173, 173, 173]);
    document.documentElement.style.setProperty("--cyber-clock-color", rgbCss(applied(clockColorValue, fallbackClockColor)));
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
    var clockColor = themeValue.clockColor ? themeValue.clockColor : null;
    document.cookie = themeKey + "=" + encodeURIComponent(JSON.stringify(sourceThemeValue)) + "; Path=/; Max-Age=31536000; SameSite=Lax";
    localStorage.setItem(themeScope === "shared" ? sharedThemeKey : themeKey, JSON.stringify(sourceThemeValue));
    var accentRgb = applied(accent, [51, 51, 51]);
    var highlightRgb = applied(highlight, [75, 0, 117]);
    var backgroundRgb = applied(background, [26, 26, 26]);
    setRgb("line", accentRgb);
    setRgb("cyan", highlightRgb);
    setBorder(border, accentRgb);
    setBackground(backgroundRgb);
    setPanel(themeValue.panel, backgroundRgb);
    setTitleColors(titleColors);
    setTitleTone(titleTone, accentRgb, highlightRgb, backgroundRgb, clockColor, titleColors);
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
    var tintStrength = Number(themeValue.lightingTintStrength);
    document.documentElement.setAttribute("data-lighting-tint", themeValue.lightingTint === true ? "on" : "off");
    document.documentElement.style.setProperty("--nova-lighting-tint-strength", String(Number.isFinite(tintStrength) ? clamp(Math.round(tintStrength), 0, 100) : 30));
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
`;
}
