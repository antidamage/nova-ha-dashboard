"use client";

import { ChevronRight } from "lucide-react";
import { useState, useId, type ReactNode } from "react";

/**
 * One device type in the Devices list, and the presets under it.
 *
 * This deliberately reuses the config page's accordion CLASSES without
 * `ConfigAccordion`'s exclusivity. A section is one of six and closing its
 * siblings is what keeps the page navigable; a device type is one of a handful
 * grouped under that section, and comparing two of them — "which of these two
 * has the presets I want" — is the whole reason the list exists. Opening one
 * must not slam the other shut.
 *
 * Closed by default, as asked: the section opens onto a list of types, not onto
 * every preset of every device at once.
 */
export function DeviceTypeGroup({
  badge,
  children,
  detail,
  icon,
  id,
  meta,
  title,
}: {
  /** Right-hand count, e.g. "2 presets". */
  badge?: string;
  children: ReactNode;
  /** The module's one-line summary, shown under the name. */
  detail: string;
  icon?: ReactNode;
  id: string;
  /** Extra right-hand text, e.g. "Driver". */
  meta?: string;
  title: string;
}) {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  return (
    <section className={`config-accordion device-type${open ? " config-accordion-open" : ""}`} id={id}>
      <div className="config-accordion-header">
        <button
          type="button"
          className="config-accordion-trigger"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
        >
          <ChevronRight className="config-accordion-arrow h-5 w-5" aria-hidden="true" />
          {icon}
          <span className="device-type-title">{title}</span>
          <span className="device-type-summary">{detail}</span>
        </button>
        <div className="config-accordion-actions">
          {meta ? <span className="device-type-meta">{meta}</span> : null}
          {badge ? <span className="device-type-badge">{badge}</span> : null}
        </div>
      </div>
      {open ? (
        <div id={bodyId} className="config-accordion-body">
          {children}
        </div>
      ) : null}
    </section>
  );
}
