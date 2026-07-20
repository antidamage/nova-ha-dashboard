"use client";

import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

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
  useEffect(() => {
    if (!open) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose, open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div className={`modal-overlay ${overlayClassName}`} role="presentation" onClick={onClose}>
      <div
        className={className}
        role={dialogRole}
        aria-modal="true"
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>,
    document.body,
  );
}
