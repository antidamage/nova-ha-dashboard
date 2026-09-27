import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WashRow } from "./laundry-row";

/**
 * Opening a wash from the bill's own row (specs/power-meters.md §5.3).
 *
 * The row is a link and a claim field at once, and the two must not be confused:
 * a tap anywhere on the row opens that wash's sheet, and a tap on the field in
 * the last cell names the wash instead — with the date's own `<a>` left to the
 * browser, so the row still works with JavaScript off and by keyboard.
 */

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

afterEach(() => push.mockClear());

function row() {
  return render(
    <table>
      <tbody>
        <WashRow className="laundry-row" href="/laundry/wash-1" style={{ background: "#22d3ee" }}>
          <td>
            <a className="laundry-row-link" href="/laundry/wash-1">
              Sat 19 Sep
            </a>
          </td>
          <td>2:05 PM</td>
          <td>
            <select aria-label="Who ran this wash" defaultValue="addie">
              <option value="addie">Addie</option>
            </select>
          </td>
        </WashRow>
      </tbody>
    </table>,
  );
}

describe("opening a wash from its row", () => {
  it("opens that wash's own sheet when the row itself is tapped", () => {
    row();

    fireEvent.click(screen.getByText("2:05 PM"));

    expect(push).toHaveBeenCalledWith("/laundry/wash-1");
  });

  it("leaves the claim field alone: naming a wash is not opening it", () => {
    row();

    fireEvent.click(screen.getByRole("combobox", { name: /Who ran this wash/ }));

    expect(push).not.toHaveBeenCalled();
  });

  it("is marked as an action, so a scroll that ends on it does not open it", () => {
    // TouchClickGuard only suppresses the click a platform synthesizes after a
    // touch scroll gesture for an element it knows acts on a tap, and the mark is
    // what tells it (app/components/TouchClickGuard.tsx, §5.3).
    const { container } = row();

    expect(container.querySelector("tr")).toHaveAttribute("data-tap-action", "true");
  });

  it("leaves the date's own link to the browser", () => {
    // Clicking a link inside the row must not also push the route: the browser is
    // already going there, and a second navigation would drop the click's own
    // handling (a new tab, a middle click).
    row();

    fireEvent.click(screen.getByRole("link", { name: "Sat 19 Sep" }));

    expect(push).not.toHaveBeenCalled();
  });
});
