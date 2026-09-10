import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
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
    const { container } = render(
      <ConfigBreadcrumb activeCategory={null} categoryLabel={null} onSelectRoot={() => {}} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("shows the category label and each open accordion's title, deepest last", () => {
    render(
      <>
        <ConfigBreadcrumb
          activeCategory="appearance-dashboard"
          categoryLabel="Appearance & Dashboard"
          onSelectRoot={() => {}}
        />
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
    expect(breadcrumb.getByRole("button", { name: "Appearance & Dashboard" })).toBeInTheDocument();
    expect(breadcrumb.getByRole("button", { name: "Theme & Experience" })).toBeInTheDocument();
    expect(breadcrumb.getByRole("button", { name: "Theme Settings" })).toBeInTheDocument();
  });

  it("clicking the root crumb backs out to the category menu", () => {
    const onSelectRoot = vi.fn();
    render(
      <ConfigBreadcrumb
        activeCategory="appearance-dashboard"
        categoryLabel="Appearance & Dashboard"
        onSelectRoot={onSelectRoot}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Appearance & Dashboard" }));
    expect(onSelectRoot).toHaveBeenCalledTimes(1);
  });

  it("fades out with one or no breadcrumbs and fades in one level deep", async () => {
    render(
      <>
        <ConfigBreadcrumb
          activeCategory="appearance-dashboard"
          categoryLabel="Appearance & Dashboard"
          onSelectRoot={() => {}}
        />
        <div id="config-category-content">
          <ConfigAccordion id="appearance" title="Theme & Experience">
            <p>Content</p>
          </ConfigAccordion>
        </div>
      </>,
    );
    expect(screen.getByRole("navigation", { name: "Configuration section path" })).toHaveClass(
      "config-breadcrumb-shallow",
    );

    fireEvent.click(screen.getByRole("button", { name: "Theme & Experience" }));

    await waitFor(() =>
      expect(screen.getByRole("navigation", { name: "Configuration section path" })).not.toHaveClass(
        "config-breadcrumb-shallow",
      ),
    );
  });

  it("clicking a crumb never closes or shortens the open accordion chain", () => {
    render(
      <>
        <ConfigBreadcrumb
          activeCategory="appearance-dashboard"
          categoryLabel="Appearance & Dashboard"
          onSelectRoot={() => {}}
        />
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
