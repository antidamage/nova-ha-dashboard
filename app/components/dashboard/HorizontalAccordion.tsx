"use client";

// Adapted from nova-multimeter/app/src/panels/HAccordion.tsx: a section folds
// into a vertical bar instead of leaving an empty column in the horizontal row.
// Keep one trigger mounted so opening/closing does not throw keyboard focus away.
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { getAccordionOpen, setAccordionOpen } from "../configUiState";

const WIDE_QUERY = "(aspect-ratio > 1)";
function subscribeWide(change: () => void) {
  const media = window.matchMedia(WIDE_QUERY);
  media.addEventListener("change", change);
  return () => media.removeEventListener("change", change);
}
const readWide = () => window.matchMedia(WIDE_QUERY).matches;
const readServerWide = () => false;

/** True while the dashboard is in its horizontal (wider-than-tall) layout. */
export function useWideDashboard(): boolean {
  return useSyncExternalStore(subscribeWide, readWide, readServerWide);
}

// `attached` is this entry's selected-zone controls, joined to the list as one
// unit: to the right of it in landscape (specs/landscape-layout.md), below it in
// portrait (specs/portrait-layout.md).
// `attachKey` is this entry's selected zone id; when it changes while the entry
// is closed, the entry opens. `group` names the entry for CSS.
export function HorizontalAccordion({
  title, persistKey, children, attached, attachKey, group, defaultOpen = false, ariaLabel,
}: {
  title: string;
  /** Spoken name for the trigger. Defaults to the zone menus' "<title> zones". */
  ariaLabel?: string;
  persistKey: string;
  children: ReactNode;
  attached?: ReactNode;
  attachKey?: string | null;
  group?: string;
  defaultOpen?: boolean;
}) {
  const wide = useWideDashboard();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const triggerId = useId();
  const lastAttachKey = useRef(attachKey);

  useEffect(() => {
    setOpen(getAccordionOpen(persistKey) ?? defaultOpen);
  }, [persistKey, defaultOpen]);

  useEffect(() => {
    const previous = lastAttachKey.current;
    if (attachKey === previous) return;
    lastAttachKey.current = attachKey;
    // `previous` is empty while the first snapshot loads: that is a restore,
    // not a selection, so it leaves the saved open/closed state alone.
    if (previous && attachKey) {
      setOpen(true);
      setAccordionOpen(persistKey, true);
    }
  }, [attachKey, persistKey]);

  // One open/closed state for both orientations, kept in the dashboard's
  // short-lived accordion storage. Landscape's bar is vertical and opens
  // sideways; portrait's is a full-width bar that opens downward.
  const expanded = open;
  const indicator = wide
    ? expanded ? <ChevronLeft size={24} /> : <ChevronRight size={24} />
    : expanded ? <ChevronDown size={24} /> : <ChevronRight size={24} />;
  return (
    <section className="horizontal-accordion" data-open={expanded} data-group={group}>
      <MomentaryFeedbackButton
        id={triggerId}
        type="button"
        className="horizontal-accordion-trigger"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={ariaLabel ?? `${title} zones`}
        onClick={() => {
          const next = !open;
          setOpen(next);
          setAccordionOpen(persistKey, next);
        }}
      >
        <span className="horizontal-accordion-title">{title}</span>
        <span className="horizontal-accordion-indicator" aria-hidden="true">
          {indicator}
        </span>
      </MomentaryFeedbackButton>
      <div id={contentId} className="horizontal-accordion-content" hidden={!expanded} aria-labelledby={triggerId}>
        {children}
      </div>
      {expanded && attached ? <div className="horizontal-accordion-attached">{attached}</div> : null}
    </section>
  );
}
