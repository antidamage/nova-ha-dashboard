import { CONFIG_CATEGORIES, CONFIG_PATH_PREFIX, HASH_CATEGORY } from "./constants";
import type { ConfigCategoryId } from "./types";

/** Parse "/config/<category>/<slug>/<slug>/..." into its category and slug chain. */
export function parseConfigPath(pathname: string): { category: ConfigCategoryId | null; slugs: string[] } {
  const withoutTrailingSlash = pathname.replace(/\/+$/, "");
  const rest = withoutTrailingSlash.startsWith(CONFIG_PATH_PREFIX)
    ? withoutTrailingSlash.slice(CONFIG_PATH_PREFIX.length)
    : "";
  const [maybeCategory, ...slugs] = rest.split("/").filter(Boolean);
  const category = CONFIG_CATEGORIES.some(({ id }) => id === maybeCategory)
    ? (maybeCategory as ConfigCategoryId)
    : null;
  return { category, slugs: category ? slugs : [] };
}

/** True when the current URL (path or legacy hash) names a specific section to open. */
export function hasDeepLinkTarget(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  if (parseConfigPath(window.location.pathname).slugs.length > 0) {
    return true;
  }
  const hashKey = window.location.hash.replace(/^#/, "");
  return hashKey.length > 0 && Boolean(HASH_CATEGORY[hashKey]);
}

/** Rewrite the URL's pathname to match the open accordion chain, trailing slash included. */
export function syncConfigPath(category: ConfigCategoryId | null, chain: string[]) {
  const path = category ? `${CONFIG_PATH_PREFIX}/${[category, ...chain].join("/")}/` : `${CONFIG_PATH_PREFIX}/`;
  const current = new URL(window.location.href);
  if (current.pathname === path) {
    return;
  }
  // Never pushState: folding/unfolding replaces the current history entry,
  // matching the category-switch behaviour this replaces.
  window.history.replaceState(window.history.state, "", `${path}${current.search}`);
}
