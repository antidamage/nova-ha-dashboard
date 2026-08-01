import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigColorPicker } from "./ConfigColorPicker";
import { ColorWidget, SliderControlPanel } from "./ConfigControls";
import { resetControlInteractionCooldownForTests } from "./controlInteractionCooldown";

const rgbAtPosition = (x: number, y: number): [number, number, number] => [Math.round(x * 255), Math.round(y * 255), 10];

function setBounds(element: HTMLElement) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({
    bottom: 70, height: 50, left: 10, right: 210, top: 20, width: 200, x: 10, y: 20,
    toJSON: () => ({}),
  });
}

describe("ConfigColorPicker", () => {
  afterEach(() => resetControlInteractionCooldownForTests());

  it("emits immediate tap and drag positions using the supplied colour mapping", () => {
    const onChange = vi.fn();
    const onCommit = vi.fn();
    render(<ConfigColorPicker ariaLabel="Accent color spectrum" cursor={{ x: 0, y: 0 }} onChange={onChange} onCommit={onCommit} rgbAtPosition={rgbAtPosition} />);
    const picker = screen.getByRole("slider");
    setBounds(picker);

    fireEvent.pointerDown(picker, { buttons: 1, clientX: 60, clientY: 45, pointerId: 1 });
    fireEvent.pointerMove(picker, { buttons: 1, clientX: 160, clientY: 70, pointerId: 1 });
    fireEvent.pointerUp(picker, { clientX: 160, clientY: 70, pointerId: 1 });

    expect(onChange).toHaveBeenNthCalledWith(1, { x: 0.25, y: 0.5 }, [64, 128, 10]);
    expect(onChange).toHaveBeenLastCalledWith({ x: 0.75, y: 1 }, [191, 255, 10]);
    expect(onCommit).toHaveBeenCalledWith({ x: 0.75, y: 1 }, [191, 255, 10]);
  });

  it("does not select or expose a tabbable control when disabled", () => {
    const onChange = vi.fn();
    render(<ConfigColorPicker ariaLabel="Disabled spectrum" cursor={{ x: 0.5, y: 0.5 }} disabled onChange={onChange} rgbAtPosition={rgbAtPosition} />);
    const picker = screen.getByRole("slider");
    setBounds(picker);
    fireEvent.pointerDown(picker, { buttons: 1, clientX: 100, clientY: 40, pointerId: 1 });

    expect(picker).toHaveAttribute("aria-disabled", "true");
    expect(picker).toHaveAttribute("tabindex", "-1");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("places colour controls in the responsive configuration editor grid", () => {
    render(
      <ColorWidget active detail="Test" label="Accent" rgb={[1, 2, 3]} onToggle={vi.fn()}>
        <div>picker</div>
        <div>intensity</div>
        <div>opacity</div>
      </ColorWidget>,
    );

    const editor = screen.getByText("picker").parentElement;
    expect(editor).toHaveClass("config-color-editor");
    expect(editor?.children).toHaveLength(3);
  });

  it("renders an active colour editor in a modal", () => {
    const onToggle = vi.fn();
    render(
      <ColorWidget active detail="Test" label="Accent" rgb={[1, 2, 3]} onToggle={onToggle}>
        <div>picker</div>
        <div>intensity</div>
      </ColorWidget>,
    );

    const dialog = screen.getByRole("dialog", { name: "Accent colour picker" });
    expect(dialog).toBeInTheDocument();
    expect(dialog).toHaveClass("theme-colour-popover");
    expect(dialog.parentElement).toHaveClass("theme-colour-overlay");
    expect(document.body.style.position).toBe("fixed");
    expect(document.documentElement.style.overflow).toBe("hidden");
    expect(dialog.parentElement?.parentElement).toBe(document.body);
    expect(screen.getByText("picker").compareDocumentPosition(screen.getByText("intensity"))).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    fireEvent.click(dialog);
    expect(onToggle).not.toHaveBeenCalled();
    fireEvent.click(dialog.parentElement!);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it("keeps focus inside the colour editor modal", () => {
    render(
      <ColorWidget active detail="Test" label="Accent" rgb={[1, 2, 3]} onToggle={vi.fn()}>
        <button type="button">First editor control</button>
        <button type="button">Last editor control</button>
      </ColorWidget>,
    );

    const dialog = screen.getByRole("dialog", { name: "Accent colour picker" });
    const trigger = document.querySelector<HTMLButtonElement>(".theme-display-card")!;
    const close = screen.getByRole("button", { name: "Close Accent colour picker" });
    const last = screen.getByRole("button", { name: "Last editor control" });
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    trigger.focus();
    expect(dialog).toContainElement(document.activeElement as HTMLElement);

    last.focus();
    fireEvent.keyDown(window, { key: "Tab" });
    expect(close).toHaveFocus();

    fireEvent.keyDown(window, { key: "Tab", shiftKey: true });
    expect(last).toHaveFocus();
  });

  it("shows colour intensity and renders the intensity-adjusted swatch", () => {
    render(
      <ColorWidget
        active={false}
        detail="Visualiser palette colour"
        intensity={0}
        label="Background"
        rgb={[255, 255, 255]}
        onToggle={vi.fn()}
      >
        <div>picker</div>
      </ColorWidget>,
    );

    expect(screen.getByText("Intensity 0%")).toBeInTheDocument();
    expect(document.querySelector(".theme-display-swatch")).toHaveStyle({
      backgroundColor: "rgb(0, 0, 0)",
    });
  });

  it("previews a config slider during drag and commits exactly once on release", () => {
    const onPreview = vi.fn();
    const onCommit = vi.fn();
    render(
      <SliderControlPanel
        ariaLabel="Save-on-release slider"
        ariaValueText="20 percent"
        color={[1, 2, 3]}
        label="Test"
        min={0}
        max={100}
        step={1}
        value={20}
        valueText="20%"
        onPreview={onPreview}
        onCommit={onCommit}
      />,
    );
    const slider = screen.getByRole("slider", { name: "Save-on-release slider" });
    setBounds(slider);

    fireEvent.pointerDown(slider, { buttons: 1, clientX: 60, clientY: 45, pointerId: 1 });
    fireEvent.pointerMove(slider, { buttons: 1, clientX: 160, clientY: 45, pointerId: 1 });
    expect(onPreview).toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.pointerUp(slider, { clientX: 160, clientY: 45, pointerId: 1 });
    expect(onCommit).toHaveBeenCalledTimes(1);
  });
});
