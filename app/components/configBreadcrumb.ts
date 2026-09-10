"use client";

// Computes the ordered chain of open accordion ids under the active config
// category, from the top-level accordion down to whichever leaf is currently
// open. There is always at most one such chain — see ConfigControls.tsx's
// closeOpenSibling, which enforces at every depth that only one accordion per
// nearest-enclosing-accordion group can be open — so this never has to
// reconcile a fork, only read one off.

const CATEGORY_CONTENT_ID = "config-category-content";
const OPEN_ACCORDION_SELECTOR = ".config-accordion.config-accordion-open";

/** Nearest enclosing `.config-accordion` ancestor, or null for a top-level one. */
function nearestAccordionAncestor(element: Element): Element | null {
  return element.parentElement?.closest(".config-accordion") ?? null;
}

/**
 * Walk the mounted DOM under `#config-category-content`, following the same
 * ancestor-comparison `closeOpenSibling` already uses, and return the open
 * accordions' ids from top-level down to the deepest open leaf.
 *
 * Returns an empty array when no category is mounted or nothing is open.
 */
export function computeOpenAccordionChain(): string[] {
  if (typeof document === "undefined") {
    return [];
  }
  const root = document.getElementById(CATEGORY_CONTENT_ID);
  if (!root) {
    return [];
  }

  const openAccordions = Array.from(root.querySelectorAll(OPEN_ACCORDION_SELECTOR));
  const chain: string[] = [];
  let currentParent: Element | null = null;

  // At most one open accordion shares any given nearest-enclosing ancestor, so
  // repeatedly finding "the open accordion whose ancestor is the previous
  // link" always yields either exactly one match or none.
  for (;;) {
    const next = openAccordions.find((element) => nearestAccordionAncestor(element) === currentParent);
    if (!next || !next.id) {
      break;
    }
    chain.push(next.id);
    currentParent = next;
  }

  return chain;
}

/**
 * Deferred, prefers-reduced-motion-aware scroll to an accordion by id.
 *
 * Same two-frame defer as ConfigAccordion's own click-to-open scroll: opening
 * an accordion also collapses whatever sibling was open, and if that sibling
 * sat above it the page shrinks underneath before layout has settled.
 */
export function scrollToAccordionId(id: string) {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const element = document.getElementById(id);
      if (typeof element?.scrollIntoView !== "function") {
        return;
      }
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      element.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
    });
  });
}

// --- Deep-link resolution: the shared pending-breadcrumb queue -----------
//
// Seeded once from the initial pathname's slugs. Each ConfigAccordion checks,
// on mount and whenever this queue changes, whether its own id is the next
// unconsumed slug and its nearest enclosing accordion is the one this same
// resolution pass already opened (or it's top-level and this is the first
// slug). A match opens it exclusively and consumes that slug.
//
// This has to be a plain module-level store, not component state: Phonoscope's
// accordions don't exist in the DOM until their data has loaded, so an
// accordion mounted long after the queue was seeded still needs to see it.

type PendingBreadcrumbState = {
  /** Slugs not yet matched, in order, deepest-last-to-match. */
  slugs: string[];
  /** Ids already matched this resolution pass, top-level first. */
  resolvedIds: string[];
};

let pendingBreadcrumb: PendingBreadcrumbState = { slugs: [], resolvedIds: [] };
const pendingBreadcrumbListeners = new Set<() => void>();

function notifyPendingBreadcrumbListeners() {
  for (const listener of pendingBreadcrumbListeners) {
    listener();
  }
}

/** Replace the pending queue (e.g. from a freshly parsed initial pathname). */
export function seedPendingBreadcrumb(slugs: string[]) {
  pendingBreadcrumb = { slugs, resolvedIds: [] };
  notifyPendingBreadcrumbListeners();
}

export function getPendingBreadcrumb(): PendingBreadcrumbState {
  return pendingBreadcrumb;
}

export function subscribePendingBreadcrumb(listener: () => void): () => void {
  pendingBreadcrumbListeners.add(listener);
  return () => pendingBreadcrumbListeners.delete(listener);
}

/**
 * Called by a ConfigAccordion that just opened itself as a match for the
 * queue's next slug. A no-op if `id` is not actually the current head — a
 * defensive check, not a real path, since callers only call this after
 * confirming the match themselves.
 */
export function consumePendingBreadcrumbSlug(id: string) {
  if (pendingBreadcrumb.slugs[0] !== id) {
    return;
  }
  pendingBreadcrumb = {
    slugs: pendingBreadcrumb.slugs.slice(1),
    resolvedIds: [...pendingBreadcrumb.resolvedIds, id],
  };
  notifyPendingBreadcrumbListeners();
}

/**
 * Give up on whatever remains unmatched (stale/deleted item, typo, old link).
 * Leaves `resolvedIds` alone — whatever prefix resolved stays open — and is a
 * no-op once the queue is already empty, so it's safe to call speculatively
 * from a "nothing matched for a while" timer.
 */
export function clearPendingBreadcrumbSlugs() {
  if (pendingBreadcrumb.slugs.length === 0) {
    return;
  }
  pendingBreadcrumb = { ...pendingBreadcrumb, slugs: [] };
  notifyPendingBreadcrumbListeners();
}
