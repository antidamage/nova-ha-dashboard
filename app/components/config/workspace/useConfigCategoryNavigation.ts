"use client";

import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { seedPendingBreadcrumb } from "../../configBreadcrumb";
import { setActiveConfigCategory } from "../../configUiState";
import { useHorizontalDragScroll } from "../../dashboard/useHorizontalDragScroll";
import { requestManagedDesktopWallpaperSync } from "../../managed-computers-client";
import { CONFIG_CATEGORIES, isDemoMode } from "./constants";
import type { ConfigCategoryId } from "./types";
import { useConfigDeepLink } from "./useConfigDeepLink";
import { useConfigScrollMemory } from "./useConfigScrollMemory";

// Which category the config page is showing, and everything that moves it:
// the deep-link/URL sync, scroll memory, the drag-scrollable category nav, the
// fold/unfold selection, and leaving the page.
export function useConfigCategoryNavigation() {
  const categoryNavRef = useRef<HTMLElement | null>(null);
  const scrollRestoredRef = useRef(false);
  const [activeCategory, setActiveCategory] = useState<ConfigCategoryId | null>(null);
  const router = useRouter();

  // Leaving config is the moment we push wallpapers to configured managed desktops.
  // The sync is deduplicated server-side.
  const handleBack = useCallback(() => {
    if (isDemoMode) {
      window.location.assign(`${process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH ?? ""}/`);
      return;
    }
    void requestManagedDesktopWallpaperSync().catch((error) => {
      console.error("[nova-dashboard] managed desktop wallpaper sync failed", error);
    });
    router.push("/");
  }, [router]);

  useConfigDeepLink(activeCategory, setActiveCategory);

  useConfigScrollMemory(activeCategory, scrollRestoredRef);

  const selectCategory = (category: ConfigCategoryId) => {
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    const next = activeCategory === category ? null : category;
    // A manual category switch abandons any unresolved deep-link chain from
    // the initial load — the new category's accordion tree starts fresh, and
    // the chain-sync effect (keyed on activeCategory) rewrites the URL to the
    // bare category path once it re-runs.
    seedPendingBreadcrumb([]);
    setActiveCategory(next);
    setActiveConfigCategory(next);
    if (next) {
      window.requestAnimationFrame(() => document.getElementById("config-category-content")?.scrollIntoView?.({ block: "start" }));
    }
  };

  const activeMeta = CONFIG_CATEGORIES.find(({ id }) => id === activeCategory);
  useHorizontalDragScroll(categoryNavRef);

  return { activeCategory, activeMeta, categoryNavRef, handleBack, selectCategory };
}
