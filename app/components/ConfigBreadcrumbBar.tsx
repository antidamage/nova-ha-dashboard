"use client";

// Floating, top-centre breadcrumb trail for the config page. Purely a "where
// am I / jump to" readout over the same open-accordion chain ConfigWorkspace
// already computes to keep the URL in sync (see configBreadcrumb.ts) — this
// component never opens, closes, or otherwise mutates any accordion's state.
// A crumb's click handler calls scrollToAccordionId() and nothing else.

import { ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { CONFIG_ACCORDION_CLOSE_EVENT, CONFIG_ACCORDION_OPEN_EVENT } from "./ConfigControls";
import { computeOpenAccordionChain, scrollToAccordionId } from "./configBreadcrumb";
import { useHorizontalDragScroll } from "./dashboard/useHorizontalDragScroll";

/**
 * An accordion's human-readable title isn't centrally registered anywhere —
 * ConfigAccordion only carries it as trigger JSX — so read it straight off
 * the DOM: the trigger renders `<ChevronRight /> {icon} <span>{title}</span>`,
 * and the title is always the trailing <span> of `.config-accordion-trigger`.
 */
function accordionTitle(id: string): string {
  const trigger = document.getElementById(id)?.querySelector(".config-accordion-trigger");
  const spans = trigger?.querySelectorAll("span");
  const titleSpan = spans && spans.length > 0 ? spans[spans.length - 1] : null;
  return titleSpan?.textContent?.trim() || id;
}

export function ConfigBreadcrumb({
  activeCategory,
  categoryLabel,
  onSelectRoot,
}: {
  activeCategory: string | null;
  categoryLabel: string | null;
  /** Clicking the root crumb backs out to the category menu. */
  onSelectRoot: () => void;
}) {
  const [chain, setChain] = useState<string[]>([]);
  const navRef = useRef<HTMLElement | null>(null);
  useHorizontalDragScroll(navRef);

  // Recompute on the same events (and the same coalescing-frame guard)
  // ConfigWorkspace's own URL-sync effect uses, so this never runs a frame
  // ahead or behind what the address bar shows.
  useEffect(() => {
    let pendingFrame = 0;
    const readChain = () => setChain(computeOpenAccordionChain());
    const scheduleRead = () => {
      if (pendingFrame) {
        return;
      }
      pendingFrame = window.requestAnimationFrame(() => {
        pendingFrame = 0;
        readChain();
      });
    };
    readChain();
    window.addEventListener(CONFIG_ACCORDION_OPEN_EVENT, scheduleRead);
    window.addEventListener(CONFIG_ACCORDION_CLOSE_EVENT, scheduleRead);
    return () => {
      window.removeEventListener(CONFIG_ACCORDION_OPEN_EVENT, scheduleRead);
      window.removeEventListener(CONFIG_ACCORDION_CLOSE_EVENT, scheduleRead);
      if (pendingFrame) {
        window.cancelAnimationFrame(pendingFrame);
      }
    };
  }, [activeCategory]);

  if (!activeCategory) {
    return null;
  }

  // Just the category, no accordion open yet: the trail isn't telling you
  // anything a glance at the page header doesn't already. Fade it out rather
  // than unmount it, so it doesn't pop in with a layout jump the moment the
  // first accordion opens.
  const isShallow = chain.length === 0;

  return (
    <nav
      ref={navRef}
      className={`config-breadcrumb ${isShallow ? "config-breadcrumb-shallow" : ""}`}
      aria-label="Configuration section path"
      data-nova-no-drag-scroll
    >
      <button
        type="button"
        className="config-breadcrumb-crumb config-breadcrumb-root"
        onClick={onSelectRoot}
      >
        {categoryLabel ?? activeCategory}
      </button>
      {chain.map((id) => (
        <span key={id} className="config-breadcrumb-segment">
          <ChevronRight className="config-breadcrumb-chevron h-3.5 w-3.5" aria-hidden="true" />
          <button
            type="button"
            className="config-breadcrumb-crumb"
            onClick={() => scrollToAccordionId(id)}
          >
            {accordionTitle(id)}
          </button>
        </span>
      ))}
    </nav>
  );
}
