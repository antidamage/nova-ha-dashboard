"use client";

// Remembers the config page's UI state — which accordions were expanded and the
// scroll position — so returning to /config within a short window restores where you
// were. Backed by sessionStorage and expired after 5 minutes of no interaction.

const STORAGE_KEY = "nova-config-ui";
const TTL_MS = 5 * 60 * 1000;

type ConfigUiState = {
  activeCategory?: string | null;
  updatedAt: number;
  open: Record<string, boolean>;
  scrollTop: number;
};

function readFresh(): ConfigUiState | null {
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    const parsed = JSON.parse(raw) as Partial<ConfigUiState> | null;
    if (!parsed || typeof parsed.updatedAt !== "number") {
      return null;
    }
    if (Date.now() - parsed.updatedAt > TTL_MS) {
      window.sessionStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return {
      activeCategory: typeof parsed.activeCategory === "string" ? parsed.activeCategory : null,
      updatedAt: parsed.updatedAt,
      open: parsed.open && typeof parsed.open === "object" ? parsed.open : {},
      scrollTop: Number(parsed.scrollTop) || 0,
    };
  } catch {
    return null;
  }
}

function write(state: ConfigUiState) {
  if (typeof window === "undefined") {
    return;
  }
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, updatedAt: Date.now() }));
  } catch {
    // sessionStorage may be unavailable (private mode / quota); persistence is best-effort.
  }
}

/** Fresh state (null if absent or older than the 5-minute TTL). */
export function getConfigUiState(): ConfigUiState | null {
  return readFresh();
}

/** Persisted open flag for one accordion, or undefined when nothing fresh is stored. */
export function getAccordionOpen(key: string): boolean | undefined {
  const state = readFresh();
  return state ? state.open[key] : undefined;
}

export function setAccordionOpen(key: string, open: boolean) {
  const state = readFresh() ?? { updatedAt: Date.now(), open: {}, scrollTop: 0 };
  write({ ...state, open: { ...state.open, [key]: open } });
}

export function setConfigScroll(scrollTop: number) {
  const state = readFresh() ?? { updatedAt: Date.now(), open: {}, scrollTop: 0 };
  write({ ...state, scrollTop });
}

export function getActiveConfigCategory(): string | null {
  return readFresh()?.activeCategory ?? null;
}

export function setActiveConfigCategory(activeCategory: string | null) {
  const state = readFresh() ?? { updatedAt: Date.now(), open: {}, scrollTop: 0 };
  write({ ...state, activeCategory });
}

/** Stable persistence key for an accordion from its id or title. */
export function configAccordionKey(idOrTitle: string): string {
  return idOrTitle
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
