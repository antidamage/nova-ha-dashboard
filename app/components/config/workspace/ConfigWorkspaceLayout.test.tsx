import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfigWorkspaceLayout } from "./ConfigWorkspaceLayout";

// The /config chrome's own structure, rendered directly rather than through
// ConfigWorkspace: no fetch, no category data, and the assertions are about where
// the fixed pieces sit in the DOM (specs/config-page-header.md).
function renderLayout(activeCategory: "assistant" | null) {
  return render(
    <ConfigWorkspaceLayout
      activeCategory={activeCategory}
      activeMeta={activeCategory ? { detail: "Identity, runtime and authority", label: "Assistant" } : undefined}
      categoryNavRef={{ current: null }}
      onBack={() => undefined}
      selectCategory={() => undefined}
    >
      <p>section body</p>
    </ConfigWorkspaceLayout>,
  );
}

describe("ConfigWorkspaceLayout", () => {
  it("keeps one copy of each header icon, in a band outside the page column", () => {
    const { container } = renderLayout(null);

    // One copy of each fixed icon (the old second, bottom-anchored copy of the
    // pair is gone) and one strip behind them.
    expect(container.querySelectorAll(".dashboard-back-link")).toHaveLength(1);
    expect(container.querySelectorAll(".dashboard-logout-link")).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: /back to dashboard/i })).toHaveLength(1);
    expect(container.querySelectorAll(".header-fade-strip")).toHaveLength(1);
    expect(container.querySelector(".config-bottom-actions")).toBeNull();

    // The band (Back / Log out and the pinned trail) is a DIRECT child of the
    // shell: inside `.config-layout` it would sit in that column's z-index:1
    // stacking context and paint under the orb shadow strip, whatever its own
    // z-index (background.css's direct-child rule; PR #43's second review round).
    const band = container.querySelector(".config-header-band");
    expect(band).not.toBeNull();
    expect(band?.parentElement?.classList.contains("dashboard-shell")).toBe(true);
    expect(band?.querySelectorAll("button")).toHaveLength(2);

    // The column keeps a row reserving the band's height, so no page content
    // starts underneath the fixed icons, and the trail's own row.
    expect(container.querySelector(".config-layout > .config-header-band-spacer")).not.toBeNull();
    expect(container.querySelector(".config-layout > .config-breadcrumb-slot")).not.toBeNull();
    expect(container.querySelector(".config-top-actions")).toBeNull();
  });

  it("renders the trail in both its homes, and neither on the category grid", () => {
    const { container } = renderLayout("assistant");

    // Two copies — the one that rests in the column's row and the one that pins
    // into the band — and CSS shows exactly one of them (navigation.css); the
    // hidden copy is what keeps the row's height when the trail picks up.
    const trails = container.querySelectorAll(".config-breadcrumb");
    expect(trails).toHaveLength(2);
    expect(container.querySelector(".config-header-band .config-breadcrumb")).not.toBeNull();
    expect(container.querySelector(".config-breadcrumb-slot .config-breadcrumb")).not.toBeNull();
    // The resting copy is the one in the column, at the column's own width.
    const slotTrail = container.querySelector(".config-breadcrumb-slot .config-breadcrumb");
    expect(slotTrail?.classList.contains("config-breadcrumb-shallow")).toBe(true);

    // On the plain category grid there is no category, so there is no trail.
    const grid = renderLayout(null);
    expect(grid.container.querySelectorAll(".config-breadcrumb")).toHaveLength(0);
  });
});
