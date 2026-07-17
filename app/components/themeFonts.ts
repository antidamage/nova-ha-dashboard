// Theme font registry. A single ordered list of selectable fonts powers both the
// main UI font (`DeviceTheme.font` -> --cyber-display, which `body` inherits) and
// the clock readout (`DeviceTheme.clockFont` -> --cyber-clock). Every entry is a
// Google Font; they are all declared once via the combined stylesheet `<link>` in
// app/layout.tsx, but the browser only downloads the woff2 for fonts actually
// rendered, so listing the whole catalogue is cheap.
//
// The first entry is the current/default UI font (Rajdhani) so an upgraded
// dashboard with no saved font keeps its existing look. The current clock font
// (Share Tech Mono) is the clock default. Both stay in the list so they remain
// selectable.

export type ThemeFontKind = "sans" | "serif" | "mono" | "display" | "handwriting" | "digital";

export type ThemeFontOption = {
  // Stable id stored in the theme. Kebab-case of the family name.
  id: string;
  // Human label shown in the picker.
  label: string;
  // CSS font-family stack: primary family first, then sensible fallbacks.
  stack: string;
  // Google Fonts `family=` spec, already URL-shaped
  // (e.g. "Rajdhani:wght@500;600;700").
  google: string;
  kind: ThemeFontKind;
};

const SANS_FALLBACK = "system-ui, sans-serif";
const SERIF_FALLBACK = "Georgia, \"Times New Roman\", serif";
const MONO_FALLBACK = "\"Consolas\", \"Courier New\", monospace";
const CURSIVE_FALLBACK = "\"Brush Script MT\", cursive";

export const THEME_FONT_OPTIONS: ReadonlyArray<ThemeFontOption> = [
  // Current default UI font — first choice.
  { id: "rajdhani", label: "Rajdhani", google: "Rajdhani:wght@300;400;500;600;700", kind: "display", stack: `"Rajdhani", "Arial Narrow", ${SANS_FALLBACK}` },
  // Broad-weight UI/text faces.
  { id: "inter", label: "Inter", google: "Inter:wght@100..900", kind: "sans", stack: `"Inter", ${SANS_FALLBACK}` },
  { id: "roboto", label: "Roboto", google: "Roboto:wght@100..900", kind: "sans", stack: `"Roboto", ${SANS_FALLBACK}` },
  { id: "roboto-condensed", label: "Roboto Condensed", google: "Roboto+Condensed:wght@100..900", kind: "sans", stack: `"Roboto Condensed", "Arial Narrow", ${SANS_FALLBACK}` },
  { id: "noto-sans", label: "Noto Sans", google: "Noto+Sans:wght@100..900", kind: "sans", stack: `"Noto Sans", ${SANS_FALLBACK}` },
  { id: "public-sans", label: "Public Sans", google: "Public+Sans:wght@100..900", kind: "sans", stack: `"Public Sans", ${SANS_FALLBACK}` },
  { id: "work-sans", label: "Work Sans", google: "Work+Sans:wght@100..900", kind: "sans", stack: `"Work Sans", ${SANS_FALLBACK}` },
  { id: "manrope", label: "Manrope", google: "Manrope:wght@200..800", kind: "sans", stack: `"Manrope", ${SANS_FALLBACK}` },
  { id: "barlow", label: "Barlow", google: "Barlow:wght@100;200;300;400;500;600;700;800;900", kind: "sans", stack: `"Barlow", ${SANS_FALLBACK}` },
  { id: "overpass", label: "Overpass", google: "Overpass:wght@100..900", kind: "sans", stack: `"Overpass", ${SANS_FALLBACK}` },
  { id: "geist", label: "Geist", google: "Geist:wght@100..900", kind: "sans", stack: `"Geist", ${SANS_FALLBACK}` },
  { id: "arimo", label: "Arimo", google: "Arimo:wght@400;600;700", kind: "sans", stack: `"Arimo", ${SANS_FALLBACK}` },
  { id: "fira-sans", label: "Fira Sans", google: "Fira+Sans:wght@100;200;300;400;500;600;700;800;900", kind: "sans", stack: `"Fira Sans", ${SANS_FALLBACK}` },
  { id: "schibsted-grotesk", label: "Schibsted Grotesk", google: "Schibsted+Grotesk:wght@400..900", kind: "sans", stack: `"Schibsted Grotesk", ${SANS_FALLBACK}` },
  { id: "josefin-sans", label: "Josefin Sans", google: "Josefin+Sans:wght@100..700", kind: "sans", stack: `"Josefin Sans", ${SANS_FALLBACK}` },
  { id: "space-grotesk", label: "Space Grotesk", google: "Space+Grotesk:wght@300..700", kind: "sans", stack: `"Space Grotesk", ${SANS_FALLBACK}` },
  { id: "urbanist", label: "Urbanist", google: "Urbanist:wght@100..900", kind: "sans", stack: `"Urbanist", ${SANS_FALLBACK}` },
  { id: "league-spartan", label: "League Spartan", google: "League+Spartan:wght@100..900", kind: "display", stack: `"League Spartan", ${SANS_FALLBACK}` },
  // Cyber/display faces with several real weight stops.
  { id: "smooch-sans", label: "Smooch Sans", google: "Smooch+Sans:wght@100..900", kind: "sans", stack: `"Smooch Sans", "Arial Narrow", ${SANS_FALLBACK}` },
  { id: "orbitron", label: "Orbitron", google: "Orbitron:wght@400..900", kind: "display", stack: `"Orbitron", "Share Tech Mono", ${SANS_FALLBACK}` },
  { id: "exo-2", label: "Exo 2", google: "Exo+2:wght@100..900", kind: "sans", stack: `"Exo 2", ${SANS_FALLBACK}` },
  { id: "saira", label: "Saira", google: "Saira:wght@100..900", kind: "sans", stack: `"Saira", ${SANS_FALLBACK}` },
  { id: "saira-condensed", label: "Saira Condensed", google: "Saira+Condensed:wght@100;200;300;400;500;600;700;800;900", kind: "display", stack: `"Saira Condensed", "Arial Narrow", ${SANS_FALLBACK}` },
  { id: "tomorrow", label: "Tomorrow", google: "Tomorrow:wght@100;200;300;400;500;600;700;800;900", kind: "display", stack: `"Tomorrow", ${SANS_FALLBACK}` },
  { id: "oxanium", label: "Oxanium", google: "Oxanium:wght@200..800", kind: "display", stack: `"Oxanium", "Share Tech Mono", ${SANS_FALLBACK}` },
  { id: "tektur", label: "Tektur", google: "Tektur:wght@400..900", kind: "display", stack: `"Tektur", "Share Tech Mono", ${SANS_FALLBACK}` },
  { id: "chakra-petch", label: "Chakra Petch", google: "Chakra+Petch:wght@300;400;500;600;700", kind: "display", stack: `"Chakra Petch", ${SANS_FALLBACK}` },
  { id: "black-ops-one", label: "Black Ops One", google: "Black+Ops+One", kind: "display", stack: `"Black Ops One", "Impact", ${SANS_FALLBACK}` },
  { id: "noto-serif", label: "Noto Serif", google: "Noto+Serif:wght@400;600;700", kind: "serif", stack: `"Noto Serif", ${SERIF_FALLBACK}` },
  { id: "fjalla-one", label: "Fjalla One", google: "Fjalla+One", kind: "display", stack: `"Fjalla One", "Arial Narrow", ${SANS_FALLBACK}` },
  { id: "lobster-two", label: "Lobster Two", google: "Lobster+Two:ital,wght@0,400;0,700;1,400", kind: "display", stack: `"Lobster Two", ${CURSIVE_FALLBACK}` },
  { id: "source-code-pro", label: "Source Code Pro", google: "Source+Code+Pro:wght@200..900", kind: "mono", stack: `"Source Code Pro", ${MONO_FALLBACK}` },
  { id: "alfa-slab-one", label: "Alfa Slab One", google: "Alfa+Slab+One", kind: "display", stack: `"Alfa Slab One", ${SERIF_FALLBACK}` },
  { id: "bungee", label: "Bungee", google: "Bungee", kind: "display", stack: `"Bungee", "Impact", ${SANS_FALLBACK}` },
  { id: "noto-serif-jp", label: "Noto Serif JP", google: "Noto+Serif+JP:wght@400;600;700", kind: "serif", stack: `"Noto Serif JP", "Noto Serif", ${SERIF_FALLBACK}` },
  { id: "ibm-plex-mono", label: "IBM Plex Mono", google: "IBM+Plex+Mono:wght@100;200;300;400;500;600;700", kind: "mono", stack: `"IBM Plex Mono", ${MONO_FALLBACK}` },
  { id: "lobster", label: "Lobster", google: "Lobster", kind: "display", stack: `"Lobster", ${CURSIVE_FALLBACK}` },
  { id: "press-start-2p", label: "Press Start 2P", google: "Press+Start+2P", kind: "display", stack: `"Press Start 2P", "Share Tech Mono", ${MONO_FALLBACK}` },
  { id: "indie-flower", label: "Indie Flower", google: "Indie+Flower", kind: "handwriting", stack: `"Indie Flower", ${CURSIVE_FALLBACK}` },
  // Current default clock font.
  { id: "share-tech-mono", label: "Share Tech Mono", google: "Share+Tech+Mono", kind: "mono", stack: `"Share Tech Mono", ${MONO_FALLBACK}` },
  // Digital readout font — dot-matrix LED look, well suited to the clock.
  { id: "doto", label: "Doto (Digital)", google: "Doto:wght@100..900", kind: "digital", stack: `"Doto", "Share Tech Mono", ${MONO_FALLBACK}` },
];

export const DEFAULT_THEME_FONT_ID = "rajdhani";
export const DEFAULT_CLOCK_FONT_ID = "share-tech-mono";

const THEME_FONT_BY_ID: Record<string, ThemeFontOption> = Object.fromEntries(
  THEME_FONT_OPTIONS.map((option) => [option.id, option]),
);

export function getThemeFont(id: string | null | undefined): ThemeFontOption | null {
  return (id && THEME_FONT_BY_ID[id]) || null;
}

/** Coerce an arbitrary stored value to a known font id, falling back to a default. */
export function normalizeThemeFontId(value: unknown, fallback: string): string {
  return typeof value === "string" && value in THEME_FONT_BY_ID ? value : fallback;
}

/** The CSS font-family stack for a font id (default font's stack if unknown). */
export function themeFontStack(id: string): string {
  return (THEME_FONT_BY_ID[id] ?? THEME_FONT_BY_ID[DEFAULT_THEME_FONT_ID]).stack;
}

/** id -> CSS stack map, used to seed --cyber-display / --cyber-clock on first paint. */
export function themeFontStackMap(): Record<string, string> {
  return Object.fromEntries(THEME_FONT_OPTIONS.map((option) => [option.id, option.stack]));
}

/** Combined Google Fonts stylesheet URL covering every selectable font. */
export function googleFontsHref(): string {
  const families = THEME_FONT_OPTIONS.map((option) => `family=${option.google}`).join("&");
  return `https://fonts.googleapis.com/css2?${families}&display=swap`;
}
