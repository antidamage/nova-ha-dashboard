"use client";

// Adapted from nova-multimeter/app/src/panels/HAccordion.tsx: a section folds
// into a vertical bar instead of leaving an empty column in the horizontal row.
// Keep one trigger mounted so opening/closing does not throw keyboard focus away.
import { ChevronLeft, ChevronRight } from "lucide-react";
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

// `attached` is the selected zone's controls when this entry owns the selected
// zone: rendered to the right of the list as one joined unit, landscape only
// (specs/landscape-layout.md). `attachKey` is the selected zone id; when the
// selection moves to a zone this entry owns while it is closed, it opens.
export function HorizontalAccordion({
  title, persistKey, children, attached, attachKey,
}: { title: string; persistKey: string; children: ReactNode; attached?: ReactNode; attachKey?: string | null }) {
  const wide = useWideDashboard();
  const [open, setOpen] = useState(false);
  const contentId = useId();
  const triggerId = useId();
  const lastAttachKey = useRef(attachKey);

  useEffect(() => {
    setOpen(getAccordionOpen(persistKey) ?? false);
  }, [persistKey]);

  useEffect(() => {
    const previous = lastAttachKey.current;
    if (attachKey === previous) return;
    lastAttachKey.current = attachKey;
    // `previous` is empty while the first snapshot loads: that is a restore,
    // not a selection, so it leaves the saved open/closed state alone.
    if (previous && attachKey && attached) {
      setOpen(true);
      setAccordionOpen(persistKey, true);
    }
  }, [attachKey, attached, persistKey]);

  // Portrait keeps the existing uncollapsed menu. Landscape state survives a
  // rotation and uses the dashboard's existing short-lived accordion storage.
  const expanded = !wide || open;
  return (
    <section className="horizontal-accordion" data-open={expanded}>
      <MomentaryFeedbackButton
        id={triggerId}
        type="button"
        className="horizontal-accordion-trigger"
        aria-expanded={expanded}
        aria-controls={contentId}
        aria-label={`${title} zones`}
        onClick={() => {
          const next = !open;
          setOpen(next);
          setAccordionOpen(persistKey, next);
        }}
      >
        <span className="horizontal-accordion-title">{title}</span>
        <span className="horizontal-accordion-indicator" aria-hidden="true">
          {expanded ? <ChevronLeft size={24} /> : <ChevronRight size={24} />}
        </span>
      </MomentaryFeedbackButton>
      <div id={contentId} className="horizontal-accordion-content" hidden={!expanded} aria-labelledby={triggerId}>
        {children}
      </div>
      {wide && expanded && attached ? <div className="horizontal-accordion-attached">{attached}</div> : null}
    </section>
  );
}
