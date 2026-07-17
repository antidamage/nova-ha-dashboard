import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExperienceModeModal } from "./ExperienceModeModal";
import { EXPERIENCE_MODE_STORAGE_KEY } from "./dashboard/experienceModeSetting";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-nova-lite");
});

afterEach(() => {
  cleanup();
});

describe("ExperienceModeModal", () => {
  it("prompts once on an undecided device and persists the lite choice", async () => {
    render(<ExperienceModeModal />);

    const dialog = await screen.findByRole("alertdialog", { name: "Choose your experience" });
    expect(dialog).toBeInTheDocument();

    screen.getByRole("button", { name: "Lite" }).click();

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY)).toBe("lite");
    expect(document.documentElement.hasAttribute("data-nova-lite")).toBe(true);
  });

  it("persists the full-experience choice without flagging lite", async () => {
    render(<ExperienceModeModal />);

    (await screen.findByRole("button", { name: "Full Experience" })).click();

    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
    expect(window.localStorage.getItem(EXPERIENCE_MODE_STORAGE_KEY)).toBe("rich");
    expect(document.documentElement.hasAttribute("data-nova-lite")).toBe(false);
  });

  it("never renders on a device that has already chosen", async () => {
    window.localStorage.setItem(EXPERIENCE_MODE_STORAGE_KEY, "rich");
    render(<ExperienceModeModal />);

    // The reveal happens in an effect; give it a tick before asserting absence.
    await waitFor(() => {
      expect(screen.queryByRole("alertdialog")).toBeNull();
    });
  });

  it("offers no dismissal path other than choosing", async () => {
    render(<ExperienceModeModal />);
    await screen.findByRole("alertdialog");

    const buttons = screen.getAllByRole("button");
    expect(buttons.map((button) => button.textContent)).toEqual(["Lite", "Full Experience"]);
  });
});
