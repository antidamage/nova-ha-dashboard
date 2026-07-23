import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigAccordion } from "./ConfigControls";

describe("ConfigAccordion", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/config");
  });

  it("keeps only one sibling accordion open", () => {
    render(
      <>
        <ConfigAccordion title="First">First body</ConfigAccordion>
        <ConfigAccordion title="Second">Second body</ConfigAccordion>
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(screen.getByText("First body")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Second" }));
    expect(screen.queryByText("First body")).not.toBeInTheDocument();
    expect(screen.getByText("Second body")).toBeInTheDocument();
  });

  it("closes only siblings within the active accordion path", () => {
    render(
      <ConfigAccordion title="Parent" defaultOpen>
        <ConfigAccordion title="First child">First child body</ConfigAccordion>
        <ConfigAccordion title="Second child">Second child body</ConfigAccordion>
      </ConfigAccordion>,
    );

    fireEvent.click(screen.getByRole("button", { name: "First child" }));
    fireEvent.click(screen.getByRole("button", { name: "Second child" }));

    expect(screen.getByRole("button", { name: "Parent" })).toHaveAttribute("aria-expanded", "true");
    expect(screen.queryByText("First child body")).not.toBeInTheDocument();
    expect(screen.getByText("Second child body")).toBeInTheDocument();
  });
});
