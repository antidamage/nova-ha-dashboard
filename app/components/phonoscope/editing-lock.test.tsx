import { describe, expect, it } from "vitest";
import { useState } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
import {
  PhonoscopeEditingLockProvider, useEditLock, usePhonoscopeEditingLock,
} from "./editing-lock";

/**
 * The panel in miniature: one field that holds the lock, and a button standing
 * in for a save's reply landing from the server. The reply only replaces state
 * when the lock is free, which is the whole rule.
 */
function Harness({ mounted = true }: { mounted?: boolean }) {
  const { value, isEditing } = usePhonoscopeEditingLock();
  const [echo, setEcho] = useState("none");
  return (
    <PhonoscopeEditingLockProvider value={value}>
      {mounted ? <Field /> : null}
      <button type="button" onClick={() => setEcho(isEditing() ? "blocked" : "applied")}>
        echo
      </button>
      <span data-testid="echo">{echo}</span>
    </PhonoscopeEditingLockProvider>
  );
}

function Field() {
  const editLock = useEditLock();
  return <input aria-label="Name" {...editLock} />;
}

function applyEcho() {
  fireEvent.click(screen.getByRole("button", { name: "echo" }));
  return screen.getByTestId("echo").textContent;
}

describe("phonoscope editing lock", () => {
  it("blocks a server echo while a field has focus, and allows it again on blur", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Name");

    expect(applyEcho()).toBe("applied");

    fireEvent.focus(field);
    expect(applyEcho()).toBe("blocked");

    fireEvent.blur(field);
    expect(applyEcho()).toBe("applied");
  });

  it("does not stack holds when the same field reports focus twice", () => {
    render(<Harness />);
    const field = screen.getByLabelText("Name");

    fireEvent.focus(field);
    fireEvent.focus(field);
    fireEvent.blur(field);

    // One blur has to be enough: a doubled hold would freeze the panel's state
    // for the rest of the session.
    expect(applyEcho()).toBe("applied");
  });

  it("releases the lock when a focused field unmounts", () => {
    const view = render(<Harness />);
    fireEvent.focus(screen.getByLabelText("Name"));
    expect(applyEcho()).toBe("blocked");

    // An accordion closing, or the group being deleted mid-rename: the blur
    // never arrives, so the unmount cleanup is what frees the panel.
    act(() => { view.rerender(<Harness mounted={false} />); });
    expect(applyEcho()).toBe("applied");
  });
});
