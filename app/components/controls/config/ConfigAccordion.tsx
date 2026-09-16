"use client";

import { ChevronRight } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import {
  consumePendingBreadcrumbSlug,
  getPendingBreadcrumb,
  subscribePendingBreadcrumb,
} from "../../configBreadcrumb";
import { configAccordionKey, getAccordionOpen, setAccordionOpen } from "../../configUiState";
import { CONFIG_ACCORDION_CLOSE_EVENT, CONFIG_ACCORDION_OPEN_EVENT } from "./constants";
import type { ConfigAccordionCloseDetail, ConfigAccordionOpenDetail } from "./types";

export function ConfigAccordion({
  actions,
  children,
  className = "",
  defaultOpen = false,
  icon,
  id,
  title,
}: {
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  defaultOpen?: boolean;
  /** Section icon shown before the title; drawn in the title's text colour. */
  icon?: ReactNode;
  id?: string;
  title: string;
}) {
  const persistKey = configAccordionKey(id ?? title);
  const [open, setOpen] = useState(defaultOpen);
  const bodyId = useId();
  const sectionRef = useRef<HTMLElement | null>(null);
  const restoredRef = useRef(false);

  /**
   * Bring a just-opened section to the top of the viewport.
   *
   * Deferred by two frames rather than run inline: opening also collapses the
   * open sibling, and if that sibling sits above this one the page shrinks
   * underneath us. Measuring before React has committed both changes scrolls to
   * a position that no longer exists by the time it lands. One frame gets the
   * commit, the second gets layout after it.
   *
   * `behavior: "smooth"` is deliberate and deliberately local. Page-level smooth
   * scrolling was removed from this app on purpose (see globals.css) so ordinary
   * navigation lands instantly; this is an explicit exception for a direct
   * manipulation, where the slide is what shows you the page moved rather than
   * jumped. Honours prefers-reduced-motion, for whom an instant jump IS correct.
   */
  const scrollSectionIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const section = sectionRef.current;
        // Guarded: this runs two frames late, so the section may have unmounted,
        // and jsdom (tests) has no scrollIntoView at all. Neither is a reason to
        // throw out of an animation-frame callback, where nothing can catch it.
        if (typeof section?.scrollIntoView !== "function") {
          return;
        }
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        section.scrollIntoView({
          behavior: reduceMotion ? "auto" : "smooth",
          block: "start",
        });
      });
    });
  }, []);

  const openExclusively = useCallback(
    (options?: { scrollIntoView?: boolean }) => {
      setOpen(true);
      setAccordionOpen(persistKey, true);
      if (sectionRef.current) {
        window.dispatchEvent(new CustomEvent<ConfigAccordionOpenDetail>(CONFIG_ACCORDION_OPEN_EVENT, {
          detail: { element: sectionRef.current, persistKey },
        }));
      }
      if (options?.scrollIntoView) {
        scrollSectionIntoView();
      }
    },
    [persistKey, scrollSectionIntoView],
  );

  const toggleOpen = () => {
    if (open) {
      setOpen(false);
      setAccordionOpen(persistKey, false);
      if (sectionRef.current) {
        window.dispatchEvent(new CustomEvent<ConfigAccordionCloseDetail>(CONFIG_ACCORDION_CLOSE_EVENT, {
          detail: { element: sectionRef.current, persistKey },
        }));
      }
      return;
    }
    // Scrolls only on a real click. The restore-on-return effect below also
    // opens a section, and scrolling there would yank the page on every load.
    openExclusively({ scrollIntoView: true });
  };

  // Accordions with the same nearest accordion ancestor are siblings. Opening
  // one sibling closes the rest, leaving the ancestor chain open.
  useEffect(() => {
    const closeOpenSibling = (event: Event) => {
      const { element, persistKey: openedKey } = (event as CustomEvent<ConfigAccordionOpenDetail>).detail;
      if (openedKey === persistKey || !sectionRef.current) {
        return;
      }
      const ownParent = sectionRef.current.parentElement?.closest(".config-accordion");
      const openedParent = element.parentElement?.closest(".config-accordion");
      if (ownParent === openedParent) {
        setOpen(false);
        setAccordionOpen(persistKey, false);
        if (sectionRef.current) {
          window.dispatchEvent(new CustomEvent<ConfigAccordionCloseDetail>(CONFIG_ACCORDION_CLOSE_EVENT, {
            detail: { element: sectionRef.current, persistKey },
          }));
        }
      }
    };

    window.addEventListener(CONFIG_ACCORDION_OPEN_EVENT, closeOpenSibling);
    return () => window.removeEventListener(CONFIG_ACCORDION_OPEN_EVENT, closeOpenSibling);
  }, [persistKey]);

  // Restore the previously-expanded state when returning to /config within the 5-min
  // window. Runs once and before the pending-breadcrumb effect below, so a deep-linked
  // path still wins over a remembered collapsed state (the effect below opens
  // exclusively, overriding whatever this one decided).
  useEffect(() => {
    if (restoredRef.current) {
      return;
    }
    restoredRef.current = true;
    const persisted = getAccordionOpen(persistKey);
    if (persisted === true || (persisted === undefined && defaultOpen)) {
      openExclusively();
    } else if (persisted === false) {
      setOpen(false);
    }
  }, [defaultOpen, openExclusively, persistKey]);

  // Deep-link resolution: on mount, and whenever the shared pending-breadcrumb
  // queue changes, check whether this accordion is the queue's next unmatched
  // slug and its nearest enclosing accordion is the one this same resolution
  // pass already opened (or it's top-level and this is the first slug). A
  // match opens it exclusively — without the click-only scroll, since the
  // whole-chain auto-scroll in ConfigWorkspace handles that once — and
  // consumes the slug. Runs on mount (not just on queue-change events) so an
  // accordion that mounts after the queue was seeded — Phonoscope's dynamic
  // ones, chiefly — still gets checked.
  useEffect(() => {
    if (!id) {
      return;
    }
    const tryConsumePendingSlug = () => {
      const pending = getPendingBreadcrumb();
      if (pending.slugs[0] !== id || !sectionRef.current) {
        return;
      }
      const ownParent = sectionRef.current.parentElement?.closest(".config-accordion");
      const expectedParentId = pending.resolvedIds[pending.resolvedIds.length - 1];
      const isNextTopLevel = !ownParent && expectedParentId === undefined;
      if (!isNextTopLevel && ownParent?.id !== expectedParentId) {
        return;
      }
      openExclusively();
      consumePendingBreadcrumbSlug(id);
    };
    tryConsumePendingSlug();
    return subscribePendingBreadcrumb(tryConsumePendingSlug);
  }, [id, openExclusively]);

  return (
    <section ref={sectionRef} id={id} className={`config-accordion ${open ? "config-accordion-open" : ""} ${className}`}>
      <div className="config-accordion-header">
        <button
          type="button"
          className="config-accordion-trigger"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={toggleOpen}
        >
          <ChevronRight className="config-accordion-arrow h-5 w-5" aria-hidden="true" />
          {icon}
          <span>{title}</span>
        </button>
        {actions ? <div className="config-accordion-actions">{actions}</div> : null}
      </div>
      {open ? (
        <div id={bodyId} className="config-accordion-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}
