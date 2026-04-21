import type { Metadata } from "next";
import "./globals.css";

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
  var titleTone = stored && stored.titleTone ? stored.titleTone : "auto";
  var clamp = function (value, min, max) {
    return Math.max(min, Math.min(max, value));
  };
  var applied = function (color, fallbackRgb) {
    var rawRgb = color && Array.isArray(color.rgb) ? color.rgb : fallbackRgb;
    var intensity = clamp(Math.round(Number(color && color.intensity ? color.intensity : 100)), 15, 100) / 100;
    return rawRgb.slice(0, 3).map(function (part) {
      return clamp(Math.round(Number(part) * intensity), 0, 255);
    });
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
  if (stored) {
    document.cookie = themeKey + "=" + encodeURIComponent(JSON.stringify(stored)) + "; Path=/; Max-Age=31536000; SameSite=Lax";
    var accentRgb = applied(accent, [215, 255, 50]);
    var highlightRgb = applied(highlight, [40, 243, 255]);
    var backgroundRgb = applied(background, [37, 39, 40]);
    setRgb("line", accentRgb);
    setRgb("cyan", highlightRgb);
    setBackground(backgroundRgb);
    setTitleTone(titleTone, accentRgb, highlightRgb, backgroundRgb);
  }
} catch (_) {}
`,
          }}
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
