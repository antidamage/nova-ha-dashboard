import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigPageActions } from "./ConfigPageActions";

// The config page's header cluster: Reload (ReloadButton) is first, then these
// two. Both carry the shared fixed box and their own offset class, and neither
// renders a visible label — the inaccessible-looking icon has to keep its
// accessible name, which is also what the e2e spec selects on.
describe("ConfigPageActions", () => {
  it("renders icon-only Back and Log out in the fixed header cluster", () => {
    const onBack = vi.fn();
    render(<ConfigPageActions onBack={onBack} />);

    const back = screen.getByRole("button", { name: "Back to dashboard" });
    expect(back).toHaveClass("dashboard-config-link");
    expect(back).toHaveClass("dashboard-back-link");
    expect(back.textContent).toBe("");

    const logout = screen.getByRole("button", { name: "Log out" });
    expect(logout).toHaveClass("dashboard-config-link");
    expect(logout).toHaveClass("dashboard-logout-link");
    expect(logout.textContent).toBe("");

    fireEvent.click(back);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
