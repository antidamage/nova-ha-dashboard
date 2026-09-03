import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it, vi } from "vitest";
import { LoginProvider, useLogin } from "./LoginProvider";

// The panel does network work on mount (it opens a flow and probes the auth
// state). None of that is what this file is testing: the contract here is that
// `requestLogin()` resolves TRUE only on a real sign-in and FALSE on every
// dismissal, because a dismissal has to cancel the action that asked.
vi.mock("./LoginPanel", () => ({
  LoginPanel: ({ onSuccess, onCancel }: { onSuccess: (next: string) => void; onCancel?: () => void }) => (
    <div>
      <button type="button" onClick={() => onSuccess("/config")}>
        pretend sign in
      </button>
      <button type="button" onClick={() => onCancel?.()}>
        pretend cancel
      </button>
    </div>
  ),
}));

function Consumer() {
  const { requestLogin } = useLogin();
  const [result, setResult] = useState<string>("idle");
  return (
    <button
      type="button"
      onClick={() => {
        setResult("pending");
        void requestLogin().then((granted) => setResult(granted ? "granted" : "dismissed"));
      }}
    >
      {result}
    </button>
  );
}

function setup() {
  render(
    <LoginProvider>
      <Consumer />
    </LoginProvider>,
  );
  return screen.getByRole("button", { name: "idle" });
}

describe("LoginProvider", () => {
  it("does not render the modal until something asks for it", () => {
    setup();
    expect(screen.queryByText("pretend sign in")).toBeNull();
  });

  it("resolves true when a flow completes", async () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("pretend sign in"));
    await waitFor(() => expect(screen.getByRole("button", { name: "granted" })).toBeTruthy());
    // The modal closes on its own; a caller that navigates must not do so
    // behind a dialog that is still up.
    expect(screen.queryByText("pretend sign in")).toBeNull();
  });

  it("resolves false when cancelled, so the action that asked is abandoned", async () => {
    const trigger = setup();
    fireEvent.click(trigger);
    fireEvent.click(await screen.findByText("pretend cancel"));
    await waitFor(() => expect(screen.getByRole("button", { name: "dismissed" })).toBeTruthy());
  });

  it("resolves false when the backdrop is tapped", async () => {
    // Adeline asked for this specifically: tapping outside hides the modal AND
    // cancels the login/navigation. ModalOverlay owns the tap handling; this
    // asserts the promise contract on top of it.
    const trigger = setup();
    fireEvent.click(trigger);
    await screen.findByText("pretend sign in");
    const backdrop = document.querySelector(".modal-overlay");
    expect(backdrop).toBeTruthy();
    fireEvent.click(backdrop!);
    await waitFor(() => expect(screen.getByRole("button", { name: "dismissed" })).toBeTruthy());
  });

  it("resolves false when Escape is pressed", async () => {
    const trigger = setup();
    fireEvent.click(trigger);
    await screen.findByText("pretend sign in");
    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.getByRole("button", { name: "dismissed" })).toBeTruthy());
  });

  it("gives a no-op that reports 'not signed in' when there is no provider", async () => {
    // A surface without the provider (the stream inspector, a test harness)
    // should degrade rather than crash the page.
    render(<Consumer />);
    fireEvent.click(screen.getByRole("button", { name: "idle" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "dismissed" })).toBeTruthy());
  });
});
