import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONFIRM_EXPIRED_NOTICE_MS, ConfirmDialog, type ConfirmCopy } from "./ConfirmDialog";

// The Computers panel's Shut down timing (specs/system-power-controls.md):
// each stage locked 3 s, then live 5 s, then it expires.
const timed: ConfirmCopy = {
  armDelayMs: 3_000,
  expireMs: 5_000,
  stages: [
    { title: "Stage one", body: "First warning", confirmLabel: "Shut down Box" },
    { title: "Stage two", body: "Last chance", confirmLabel: "Shut down Box" },
  ],
};

function confirmButton() {
  return screen.getByRole("button", { name: /shut down box/i });
}

function advance(ms: number) {
  act(() => {
    vi.advanceTimersByTime(ms);
  });
}

describe("ConfirmDialog timed stages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  function setup(copy: ConfirmCopy = timed) {
    const onConfirm = vi.fn();
    const onCancel = vi.fn();
    render(<ConfirmDialog open copy={copy} onCancel={onCancel} onConfirm={onConfirm} />);
    return { onCancel, onConfirm };
  }

  it("ignores confirm while locked, keeps the button focusable, then accepts it", () => {
    const { onConfirm } = setup();
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");
    expect((confirmButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(confirmButton());
    expect(screen.getByText("Stage one")).toBeTruthy();

    advance(3_000);
    expect(confirmButton().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(confirmButton());
    expect(screen.getByText("Stage two")).toBeTruthy();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("locks stage 2 on the render it appears, so a double tap cannot confirm it", () => {
    const { onConfirm } = setup();
    advance(3_000);
    fireEvent.click(confirmButton());
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
    expect(confirmButton().getAttribute("aria-disabled")).toBe("true");

    // Stage 2 runs its own 3 s lock, then confirms inside its window.
    advance(2_900);
    fireEvent.click(confirmButton());
    expect(onConfirm).not.toHaveBeenCalled();
    advance(200);
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it("expires 5 s after the lock ends, shows the timeout line, then cancels", () => {
    const { onCancel, onConfirm } = setup();
    advance(3_000 + 5_000);
    expect(screen.getAllByText("Timed out. Nothing was sent.").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: /shut down box/i })).toBeNull();
    expect(onCancel).not.toHaveBeenCalled();
    advance(CONFIRM_EXPIRED_NOTICE_MS);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("gives stage 2 a fresh window instead of stage 1's remainder", () => {
    const { onCancel, onConfirm } = setup();
    advance(3_000 + 4_900); // confirm stage 1 with 0.1 s to spare
    fireEvent.click(confirmButton());
    advance(3_000 + 4_000); // stage 2: lock, then 4 s into its own window
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
  });

  it("stage 2 expires on its own when not confirmed", () => {
    const { onCancel, onConfirm } = setup();
    advance(3_000);
    fireEvent.click(confirmButton());
    advance(3_000);
    advance(5_000);
    expect(onCancel).not.toHaveBeenCalled();
    advance(CONFIRM_EXPIRED_NOTICE_MS);
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it("leaves untimed dialogs exactly as before", () => {
    const { onConfirm } = setup({
      stages: [{ title: "Plain", body: "Body", confirmLabel: "Shut down Box" }],
    });
    expect(confirmButton().getAttribute("aria-disabled")).toBeNull();
    fireEvent.click(confirmButton());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    advance(60_000);
    expect(screen.queryByText("Timed out. Nothing was sent.")).toBeNull();
  });
});
