import { fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigAccordion } from "./ConfigControls";
import { ConfigBreadcrumb } from "./ConfigBreadcrumbBar";
import { seedPendingBreadcrumb } from "./configBreadcrumb";

describe("ConfigBreadcrumb", () => {
  afterEach(() => {
    window.sessionStorage.clear();
    window.history.replaceState({}, "", "/config");
    seedPendingBreadcrumb([]);
  });

  it("renders nothing when no category is active", () => {
    const { container } = render(<ConfigBreadcrumb activeCategory={null} categoryLabel={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the category label and each open accordion's title, deepest last", () => {
    render(
      <>
        <ConfigBreadcrumb activeCategory="appearance-dashboard" categoryLabel="Appearance & Dashboard" />
        <div id="config-category-content">
          <ConfigAccordion id="appearance" title="Theme & Experience" defaultOpen>
            <ConfigAccordion id="theme-settings" title="Theme Settings" defaultOpen>
              <p>Deepest content</p>
            </ConfigAccordion>
          </ConfigAccordion>
        </div>
      </>,
    );

    const breadcrumb = within(screen.getByRole("navigation", { name: "Configuration section path" }));
    expect(breadcrumb.getByText("Appearance & Dashboard")).toBeInTheDocument();
    expect(breadcrumb.getByRole("button", { name: "Theme & Experience" })).toBeInTheDocument();
    expect(breadcrumb.getByRole("button", { name: "Theme Settings" })).toBeInTheDocument();
  });

  it("clicking a crumb never closes or shortens the open accordion chain", () => {
    render(
      <>
        <ConfigBreadcrumb activeCategory="appearance-dashboard" categoryLabel="Appearance & Dashboard" />
        <div id="config-category-content">
          <ConfigAccordion id="appearance" title="Theme & Experience" defaultOpen>
            <ConfigAccordion id="theme-settings" title="Theme Settings" defaultOpen>
              <p>Deepest content</p>
            </ConfigAccordion>
          </ConfigAccordion>
        </div>
      </>,
    );

    const breadcrumb = within(screen.getByRole("navigation", { name: "Configuration section path" }));
    fireEvent.click(breadcrumb.getByRole("button", { name: "Theme & Experience" }));

    // The deeper accordion must still be open/rendered — a crumb click must
    // only scroll, never toggle/close/shorten the chain.
    expect(screen.getByText("Deepest content")).toBeInTheDocument();
    expect(document.getElementById("appearance")).toHaveClass("config-accordion-open");
    expect(document.getElementById("theme-settings")).toHaveClass("config-accordion-open");
  });
});
