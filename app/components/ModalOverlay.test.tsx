import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ModalOverlay } from "./ModalOverlay";

/**
 * Focus containment, and the one case where it must stand down.
 *
 * The trap exists so keyboard focus cannot wander behind an open dialog. It
 * also fought the browser's WebAuthn picker: the picker is native UI, so the
 * moment it took focus, `focusin` fired with a target outside the dialog and
 * the trap pulled focus straight back — and Chromium will not paint a picker
 * for a document that keeps stealing focus. The passkey dialog only appeared
 * once the modal was dismissed, by which point the login was gone.
 */

function Fixture({ suspend }: { suspend?: boolean }) {
  return (
    <>
      <button type="button">outside</button>
      <ModalOverlay open onClose={() => {}} ariaLabel="Test" suspendFocusTrap={suspend}>
        <button type="button">inside</button>
      </ModalOverlay>
    </>
  );
}

describe("ModalOverlay focus containment", () => {
  it("pulls focus back into the dialog by default", () => {
    render(<Fixture />);
    const outside = screen.getByRole("button", { name: "outside", hidden: true });
    const inside = screen.getByRole("button", { name: "inside" });

    outside.focus();
    fireEvent.focusIn(outside);

    expect(document.activeElement).toBe(inside);
  });

  it("leaves focus alone while a native prompt is up", () => {
    // The fix. Without it the passkey picker never renders.
    render(<Fixture suspend />);
    const outside = screen.getByRole("button", { name: "outside", hidden: true });

    outside.focus();
    fireEvent.focusIn(outside);

    expect(document.activeElement).toBe(outside);
  });

  it("still closes on Escape while suspended", () => {
    // Only the focus containment stands down. Dismissal must keep working, or
    // a stuck ceremony would trap the user in the dialog.
    const onClose = vi.fn();
    render(
      <ModalOverlay open onClose={onClose} ariaLabel="Test" suspendFocusTrap>
        <button type="button">inside</button>
      </ModalOverlay>,
    );
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("still closes on a backdrop click while suspended", () => {
    const onClose = vi.fn();
    render(
      <ModalOverlay open onClose={onClose} ariaLabel="Test" suspendFocusTrap>
        <button type="button">inside</button>
      </ModalOverlay>,
    );
    const backdrop = document.querySelector(".modal-overlay");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("keeps the background inert while suspended", () => {
    // Suspending focus containment must not also un-hide the page behind the
    // dialog: the picker is browser UI and does not need the DOM back.
    render(<Fixture suspend />);
    const outside = screen.getByRole("button", { name: "outside", hidden: true });
    expect(outside.closest("[aria-hidden='true']")).not.toBeNull();
  });
});
