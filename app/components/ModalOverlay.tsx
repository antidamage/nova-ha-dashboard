"use client";

import { createContext, useContext, useEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const ModalPortalContext = createContext<RefObject<HTMLDivElement | null> | null>(null);

/**
 * Portalled controls inside a modal must remain DOM descendants of the dialog.
 * Otherwise the modal's inert background and focus trap correctly treat them
 * as outside content, which makes their options untappable on touch browsers.
 */
export function useModalPortalTarget() {
  return useContext(ModalPortalContext);
}

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

export function ModalOverlay({
  ariaDescribedBy,
  ariaLabel,
  ariaLabelledBy,
  children,
  className = "",
  dialogRole = "dialog",
  onClose,
  open,
  overlayClassName = "",
}: {
  ariaDescribedBy?: string;
  ariaLabel?: string;
  ariaLabelledBy?: string;
  children: ReactNode;
  className?: string;
  dialogRole?: "dialog" | "alertdialog";
  onClose: () => void;
  open: boolean;
  overlayClassName?: string;
}) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    const overlay = overlayRef.current;
    if (!dialog || !overlay) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = Array.from(document.body.children)
      .filter((element): element is HTMLElement => element instanceof HTMLElement && element !== overlay)
      .map((element) => ({
        ariaHidden: element.getAttribute("aria-hidden"),
        element,
        inert: element.inert,
      }));
    background.forEach(({ element }) => {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    });

    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const rootOverflow = document.documentElement.style.overflow;
    const bodyStyles = {
      left: document.body.style.left,
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      right: document.body.style.right,
      top: document.body.style.top,
      width: document.body.style.width,
    };
    document.documentElement.style.overflow = "hidden";
    Object.assign(document.body.style, {
      left: `${-scrollX}px`,
      overflow: "hidden",
      position: "fixed",
      right: "0",
      top: `${-scrollY}px`,
      width: "100%",
    });

    const focusable = () => Array.from(dialog.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR))
      .filter((element) => !element.hasAttribute("disabled") && element.getAttribute("aria-hidden") !== "true");
    (focusable()[0] ?? dialog).focus();

    const containFocus = (event: FocusEvent) => {
      if (!dialog.contains(event.target as Node)) {
        (focusable()[0] ?? dialog).focus();
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const candidates = focusable();
      if (candidates.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = candidates[0];
      const last = candidates[candidates.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", containFocus);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("focusin", containFocus);
      window.removeEventListener("keydown", handleKeyDown);
      background.forEach(({ ariaHidden, element, inert }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      document.documentElement.style.overflow = rootOverflow;
      Object.assign(document.body.style, bodyStyles);
      if (scrollX !== 0 || scrollY !== 0) window.scrollTo(scrollX, scrollY);
      previouslyFocused?.focus();
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <ModalPortalContext.Provider value={dialogRef}>
      <div ref={overlayRef} className={`modal-overlay ${overlayClassName}`} role="presentation" onClick={onClose}>
        <div
          ref={dialogRef}
          className={className}
          role={dialogRole}
          tabIndex={-1}
          aria-modal="true"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabelledBy}
          aria-describedby={ariaDescribedBy}
          onClick={(event) => event.stopPropagation()}
        >
          {children}
        </div>
      </div>
    </ModalPortalContext.Provider>,
    document.body,
  );
}
