import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ConfigSelect } from "./ConfigSelect";

describe("ConfigSelect", () => {
  it("renders an option icon instead of the empty colour swatch", () => {
    const { container } = render(
      <ConfigSelect
        ariaLabel="Quality"
        value="auto"
        options={[{
          value: "auto",
          label: "Auto",
          icon: <svg data-testid="quality-icon" />,
        }]}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector(".cyber-select-icon")).toContainElement(
      container.querySelector('[data-testid="quality-icon"]'),
    );
    expect(container.querySelector(".cyber-select-swatch-empty")).not.toBeInTheDocument();
  });

  it("keeps a supplied colour swatch ahead of an icon", () => {
    const { container } = render(
      <ConfigSelect
        ariaLabel="Colour theme"
        value="aurora"
        options={[{
          value: "aurora",
          label: "Aurora",
          icon: <svg data-testid="fallback-icon" />,
          swatch: <span className="cyber-select-swatch" data-testid="theme-swatch" />,
        }]}
        onChange={vi.fn()}
      />,
    );

    expect(container.querySelector('[data-testid="theme-swatch"]')).toBeInTheDocument();
    expect(container.querySelector('[data-testid="fallback-icon"]')).not.toBeInTheDocument();
  });
});
