import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CONFIG_ACCORDION_CLOSE_EVENT, ConfigAccordion } from "../../ConfigControls";
import { computeOpenAccordionChain, seedPendingBreadcrumb } from "../../configBreadcrumb";

describe("ConfigAccordion", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/config");
    seedPendingBreadcrumb([]);
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

  it("dispatches the close event when collapsing an open accordion", () => {
    render(<ConfigAccordion id="first" title="First">First body</ConfigAccordion>);

    const closed: string[] = [];
    const onClose = (event: Event) => closed.push((event as CustomEvent<{ persistKey: string }>).detail.persistKey);
    window.addEventListener(CONFIG_ACCORDION_CLOSE_EVENT, onClose);

    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(closed).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "First" }));
    expect(closed).toEqual(["first"]);

    window.removeEventListener(CONFIG_ACCORDION_CLOSE_EVENT, onClose);
  });

  it("computes the open-accordion chain from top-level down to the deepest open leaf", () => {
    render(
      <div id="config-category-content">
        <ConfigAccordion id="parent" title="Parent">
          <ConfigAccordion id="child-a" title="Child A">Child A body</ConfigAccordion>
          <ConfigAccordion id="child-b" title="Child B">Child B body</ConfigAccordion>
        </ConfigAccordion>
      </div>,
    );

    expect(computeOpenAccordionChain()).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: "Parent" }));
    expect(computeOpenAccordionChain()).toEqual(["parent"]);

    fireEvent.click(screen.getByRole("button", { name: "Child B" }));
    expect(computeOpenAccordionChain()).toEqual(["parent", "child-b"]);

    fireEvent.click(screen.getByRole("button", { name: "Child A" }));
    expect(computeOpenAccordionChain()).toEqual(["parent", "child-a"]);
  });

  it("opens the accordion chain named by a seeded deep-link queue", async () => {
    seedPendingBreadcrumb(["parent", "child-b"]);

    render(
      <div id="config-category-content">
        <ConfigAccordion id="parent" title="Parent">
          <ConfigAccordion id="child-a" title="Child A">Child A body</ConfigAccordion>
          <ConfigAccordion id="child-b" title="Child B">Child B body</ConfigAccordion>
        </ConfigAccordion>
      </div>,
    );

    await waitFor(() => expect(screen.getByText("Child B body")).toBeInTheDocument());
    expect(screen.queryByText("Child A body")).not.toBeInTheDocument();
    expect(computeOpenAccordionChain()).toEqual(["parent", "child-b"]);
  });
});
