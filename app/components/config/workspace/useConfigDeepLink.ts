"use client";

import { useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import { CONFIG_ACCORDION_CLOSE_EVENT, CONFIG_ACCORDION_OPEN_EVENT } from "../../ConfigControls";
import {
  clearPendingBreadcrumbSlugs,
  computeOpenAccordionChain,
  getPendingBreadcrumb,
  scrollToAccordionId,
  seedPendingBreadcrumb,
  subscribePendingBreadcrumb,
} from "../../configBreadcrumb";
import { getActiveConfigCategory } from "../../configUiState";
import { parseConfigPath, syncConfigPath } from "./config-path-model";
import { CONFIG_CATEGORIES, HASH_CATEGORY } from "./constants";
import type { ConfigCategoryId } from "./types";

// Path-driven category resolution, URL sync with the open accordion chain, and
// the deep-link resolve/give-up lifecycle (specs/config-breadcrumb-navigation.md).
export function useConfigDeepLink(
  activeCategory: ConfigCategoryId | null,
  setActiveCategory: Dispatch<SetStateAction<ConfigCategoryId | null>>,
) {
  // Resolve the initial category (and seed the deep-link slug queue) once from
  // the URL on mount. The path is the source of truth from here on — there is
  // no hashchange listener any more, because folding/unfolding now rewrites
  // the path instead of the hash (see the chain-sync effect below).
  useEffect(() => {
    const { category: pathCategory, slugs } = parseConfigPath(window.location.pathname);
    if (pathCategory) {
      setActiveCategory(pathCategory);
      if (slugs.length > 0) {
        seedPendingBreadcrumb(slugs);
      }
      return;
    }

    // Legacy compat: a bare /config with a hash (UpdateBanner's /config#updates,
    // or an old bookmark) predates the path scheme. Translate it once instead
    // of maintaining a separate redirect table.
    const hashKey = window.location.hash.replace(/^#/, "");
    const hashCategory = HASH_CATEGORY[hashKey];
    if (hashCategory) {
      setActiveCategory(hashCategory);
      if (hashKey !== hashCategory) {
        seedPendingBreadcrumb([hashKey]);
      }
      return;
    }

    const remembered = getActiveConfigCategory();
    setActiveCategory(CONFIG_CATEGORIES.some(({ id }) => id === remembered) ? (remembered as ConfigCategoryId) : null);
  }, []);

  // Recompute the open-accordion chain and rewrite the URL whenever an
  // accordion opens or closes, or the active category changes. This covers
  // both an ordinary fold/unfold and the deep-link resolution pass above:
  // each matched accordion opens itself via openExclusively, which dispatches
  // the same open event this listens for.
  useEffect(() => {
    const syncUrl = () => syncConfigPath(activeCategory, computeOpenAccordionChain());
    let pendingFrame = 0;
    // The open/close events are dispatched synchronously right after
    // setOpen(...), i.e. before React has committed that state to the DOM
    // (the .config-accordion-open class computeOpenAccordionChain reads).
    // Deferring the read by a frame lets the commit and paint land first;
    // the pending-frame guard coalesces multiple events in the same tick
    // into a single scheduled read.
    const scheduleSync = () => {
      if (pendingFrame) {
        return;
      }
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = 0;
        syncUrl();
      });
    };
    syncUrl();
    window.addEventListener(CONFIG_ACCORDION_OPEN_EVENT, scheduleSync);
    window.addEventListener(CONFIG_ACCORDION_CLOSE_EVENT, scheduleSync);
    return () => {
      window.removeEventListener(CONFIG_ACCORDION_OPEN_EVENT, scheduleSync);
      window.removeEventListener(CONFIG_ACCORDION_CLOSE_EVENT, scheduleSync);
      if (pendingFrame) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, [activeCategory]);

  // Auto-scroll to the deepest section only once the whole requested deep-link
  // chain has resolved — not once per intermediate level, which would jump the
  // page repeatedly as Phonoscope's async accordions mount one at a time.
  const chainResolvedScrolledRef = useRef(false);
  useEffect(() => {
    const checkResolved = () => {
      const pending = getPendingBreadcrumb();
      if (pending.slugs.length === 0 && pending.resolvedIds.length > 0 && !chainResolvedScrolledRef.current) {
        chainResolvedScrolledRef.current = true;
        scrollToAccordionId(pending.resolvedIds[pending.resolvedIds.length - 1]);
      }
    };
    checkResolved();
    return subscribePendingBreadcrumb(checkResolved);
  }, []);

  // Give up silently on a stale/deleted/mistyped segment rather than waiting
  // forever: if nothing has matched for a few seconds, drop whatever remains
  // unmatched and leave the resolved prefix open. Restarts on every match, so
  // Phonoscope's slow-to-mount dynamic accordions get the full window each.
  useEffect(() => {
    let timer: number | undefined;
    const scheduleGiveUp = () => {
      if (timer) {
        window.clearTimeout(timer);
      }
      if (getPendingBreadcrumb().slugs.length === 0) {
        return;
      }
      timer = window.setTimeout(() => clearPendingBreadcrumbSlugs(), 4000);
    };
    scheduleGiveUp();
    const unsubscribe = subscribePendingBreadcrumb(scheduleGiveUp);
    return () => {
      unsubscribe();
      if (timer) {
        window.clearTimeout(timer);
      }
    };
  }, []);
}
