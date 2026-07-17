"use client";

import { useEffect, useRef, useState } from "react";

const DEMO_TOOLTIPS_ENABLED = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const TOOLTIP_DELAY_MS = 500;
const TOOLTIP_OFFSET_X = 18;
const TOOLTIP_OFFSET_Y = 20;
const TOOLTIP_MAX_WIDTH = 286;
const TOOLTIP_MAX_HEIGHT = 132;

type DemoTooltip = {
  text: string;
  title: string;
  x: number;
  y: number;
};

type TooltipCopy = {
  text: string;
  title: string;
};

function cleanLabel(value: string | null) {
  return (value ?? "").trim().replace(/\s+/g, " ");
}

function fallbackSliderCopy(target: HTMLElement): TooltipCopy | null {
  const label = cleanLabel(target.getAttribute("aria-label"));
  if (!label) {
    return null;
  }

  const lower = label.toLowerCase();
  if (lower.includes("color spectrum")) {
    return { title: "Color Spectrum", text: "Drag to pick the active light colour." };
  }
  if (lower.includes("brightness")) {
    return { title: "Brightness", text: "Drag to dim or brighten this zone." };
  }
  if (lower.includes("fan speed")) {
    return { title: "Fan Speed", text: "Drag to adjust air movement." };
  }
  if (lower.includes("temperature")) {
    return { title: "Temperature", text: "Drag to adjust the target temperature." };
  }

  return { title: label, text: "Drag or use arrow keys to adjust this value." };
}

function fallbackClimateCopy(target: HTMLElement): TooltipCopy | null {
  if (target.classList.contains("climate-control-grid")) {
    return { title: "Climate Controls", text: "Manage air conditioner and heater settings." };
  }

  if (target.classList.contains("climate-card")) {
    const title = cleanLabel(target.querySelector("h2")?.textContent ?? null) || "Climate";
    return { title, text: "View and adjust this climate device." };
  }

  if (target.classList.contains("temperature-stepper")) {
    const title = cleanLabel(target.querySelector("p")?.textContent ?? null) || "Temperature";
    return { title, text: "Set the target temperature." };
  }

  if (target.classList.contains("climate-icon-button")) {
    const label = cleanLabel(target.getAttribute("aria-label"));
    return {
      title: label || "Temperature",
      text: label.toLowerCase().startsWith("lower") ? "Decrease the target temperature." : "Increase the target temperature.",
    };
  }

  if (target.classList.contains("aircon-state-button")) {
    const label = cleanLabel(target.textContent);
    return { title: label || "Climate State", text: "Choose this climate power state." };
  }

  if (target.classList.contains("climate-timer-button")) {
    return { title: "Climate Timer", text: "Add time before this device turns off." };
  }

  if (target.classList.contains("climate-timer-cancel")) {
    return { title: "Clear Timer", text: "Remove the climate off timer." };
  }

  if (target.classList.contains("climate-mode-button")) {
    const title = cleanLabel(target.textContent) || "Mode";
    return { title, text: "Set the air conditioner mode." };
  }

  if (target.classList.contains("cyber-switch") || target.classList.contains("climate-switch-row")) {
    const title = cleanLabel(target.getAttribute("aria-label") ?? target.querySelector("[aria-label]")?.getAttribute("aria-label") ?? null) || "Climate Switch";
    return { title, text: "Switch this climate setting." };
  }

  if (target.classList.contains("climate-fan-speed")) {
    return { title: "Fan Speed", text: "Drag to adjust air movement." };
  }

  return null;
}

function passiveTooltipTargetAt(clientX: number, clientY: number): HTMLElement | null {
  const targets = Array.from(document.querySelectorAll<HTMLElement>("[data-demo-tooltip-title][data-demo-tooltip]"));

  for (let index = targets.length - 1; index >= 0; index -= 1) {
    const target = targets[index];
    if (getComputedStyle(target).pointerEvents !== "none") {
      continue;
    }

    const rect = target.getBoundingClientRect();
    if (clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom) {
      return target;
    }
  }

  return null;
}

function targetContainsPoint(target: HTMLElement, clientX: number, clientY: number) {
  const rect = target.getBoundingClientRect();
  return clientX >= rect.left && clientX <= rect.right && clientY >= rect.top && clientY <= rect.bottom;
}

function explicitCopy(target: HTMLElement): TooltipCopy | null {
  const title = cleanLabel(target.dataset.demoTooltipTitle ?? null);
  const text = cleanLabel(target.dataset.demoTooltip ?? null);

  return title && text ? { title, text } : null;
}

function tooltipTargetFromEvent(event: PointerEvent): HTMLElement | null {
  if (event.pointerType && event.pointerType !== "mouse") {
    return null;
  }

  const target = event.target instanceof Element ? event.target : null;
  if (!target) {
    return null;
  }

  const explicit = target.closest<HTMLElement>("[data-demo-tooltip-title][data-demo-tooltip]");
  if (explicit) {
    return explicit;
  }

  const slider = target.closest<HTMLElement>('[role="slider"][aria-label]');
  if (slider && fallbackSliderCopy(slider)) {
    return slider;
  }

  const climate = target.closest<HTMLElement>(
    ".climate-control-grid, .climate-card, .temperature-stepper, .climate-icon-button, .aircon-state-button, .climate-timer-button, .climate-timer-cancel, .climate-mode-button, .cyber-switch, .climate-switch-row, .climate-fan-speed",
  );
  return climate && fallbackClimateCopy(climate) ? climate : null;
}

function copyForTarget(target: HTMLElement): TooltipCopy | null {
  return explicitCopy(target) ?? fallbackSliderCopy(target) ?? fallbackClimateCopy(target);
}

function tooltipPosition(clientX: number, clientY: number) {
  if (typeof window === "undefined") {
    return { x: clientX + TOOLTIP_OFFSET_X, y: clientY + TOOLTIP_OFFSET_Y };
  }

  return {
    x: Math.max(12, Math.min(clientX + TOOLTIP_OFFSET_X, window.innerWidth - TOOLTIP_MAX_WIDTH - 12)),
    y: Math.max(12, Math.min(clientY + TOOLTIP_OFFSET_Y, window.innerHeight - TOOLTIP_MAX_HEIGHT - 12)),
  };
}

export function DemoTooltipLayer() {
  const [tooltip, setTooltip] = useState<DemoTooltip | null>(null);
  const activeTargetRef = useRef<HTMLElement | null>(null);
  const lastPointerRef = useRef({ x: 0, y: 0 });
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!DEMO_TOOLTIPS_ENABLED) {
      return;
    }

    const clearTimer = () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };

    const hide = () => {
      clearTimer();
      activeTargetRef.current = null;
      setTooltip(null);
    };

    const schedule = (target: HTMLElement, event: PointerEvent) => {
      clearTimer();
      activeTargetRef.current = target;
      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      setTooltip(null);

      timerRef.current = window.setTimeout(() => {
        if (activeTargetRef.current !== target) {
          return;
        }

        const copy = copyForTarget(target);
        if (!copy) {
          return;
        }

        const position = tooltipPosition(lastPointerRef.current.x, lastPointerRef.current.y);
        setTooltip({ ...copy, ...position });
      }, TOOLTIP_DELAY_MS);
    };

    const onPointerOver = (event: PointerEvent) => {
      const target = tooltipTargetFromEvent(event);
      if (!target) {
        return;
      }

      if (activeTargetRef.current === target) {
        lastPointerRef.current = { x: event.clientX, y: event.clientY };
        return;
      }

      schedule(target, event);
    };

    const onPointerMove = (event: PointerEvent) => {
      const hoveredTarget = tooltipTargetFromEvent(event) ?? passiveTooltipTargetAt(event.clientX, event.clientY);
      const currentTarget = activeTargetRef.current;

      if (!currentTarget) {
        if (hoveredTarget) {
          schedule(hoveredTarget, event);
        }
        return;
      }

      if (hoveredTarget && hoveredTarget !== currentTarget) {
        schedule(hoveredTarget, event);
        return;
      }

      if (!hoveredTarget && !targetContainsPoint(currentTarget, event.clientX, event.clientY)) {
        hide();
        return;
      }

      lastPointerRef.current = { x: event.clientX, y: event.clientY };
      setTooltip((current) => {
        if (!current) {
          return current;
        }

        return { ...current, ...tooltipPosition(event.clientX, event.clientY) };
      });
    };

    const onPointerOut = (event: PointerEvent) => {
      const current = activeTargetRef.current;
      if (!current) {
        return;
      }

      const related = event.relatedTarget instanceof Node ? event.relatedTarget : null;
      if (related && current.contains(related)) {
        return;
      }

      hide();
    };

    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointermove", onPointerMove, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("wheel", hide, true);
    document.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
    window.addEventListener("scroll", hide, true);

    return () => {
      clearTimer();
      document.removeEventListener("pointerover", onPointerOver, true);
      document.removeEventListener("pointermove", onPointerMove, true);
      document.removeEventListener("pointerout", onPointerOut, true);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("wheel", hide, true);
      document.removeEventListener("keydown", hide, true);
      window.removeEventListener("blur", hide);
      window.removeEventListener("scroll", hide, true);
    };
  }, []);

  if (!DEMO_TOOLTIPS_ENABLED || !tooltip) {
    return null;
  }

  return (
    <aside
      aria-hidden="true"
      className="demo-tooltip"
      style={{ left: tooltip.x, top: tooltip.y }}
    >
      <div className="demo-tooltip-title">{tooltip.title}</div>
      <div className="demo-tooltip-text">{tooltip.text}</div>
    </aside>
  );
}
