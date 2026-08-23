"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { decimalStepGranularity } from "../../lib/slider-step";
import { beginControlInteraction, endControlInteraction } from "./controlInteractionCooldown";
import { beginKioskTextEditing } from "./kioskTextEditing";
import { useModalPortalTarget } from "./ModalOverlay";
import { useEditLock } from "./phonoscope/editing-lock";

/**
 * The small numeric field a slider tap opens.
 *
 * Sliders are dragged, which is fine for feel and useless for precision: there
 * was no way to ask for exactly 0.25s, and on the kiosk touchscreen a drag was
 * the only affordance at all. A tap now opens this, already focused, so the
 * number can simply be typed.
 *
 * It is portalled and fixed-position for the same reason every cyber-select
 * menu is (see useSelectMenu): as an absolute child of a config card it would
 * be trapped inside that card's stacking context and overflow, and paint behind
 * the panel below it. It sits *above* its control rather than below because on
 * the kiosk the KWin virtual keyboard covers the bottom of the screen, and on
 * iOS the bottom strip is the gesture blind spot.
 */

const EDGE_MARGIN_PX = 8;

export type NumericEntryRequest = {
  /** Element the popover is measured against — the slider track. */
  anchor: HTMLElement;
  /** Horizontal offset within the anchor to centre on, i.e. the thumb. */
  anchorOffsetX: number;
  /** Range hint shown under the field. Defaults to `min – max`. */
  hint?: string;
  label: string;
  max: number;
  min: number;
  onCommit: (value: number) => void;
  /** Runs however the popover closes, committed or cancelled. */
  onClose?: () => void;
  step: number;
  value: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function stepDecimals(step: number) {
  const granularity = decimalStepGranularity(step);
  if (Number.isInteger(granularity)) return 0;
  return Math.max(0, Math.ceil(-Math.log10(granularity)));
}

/** The value as the field should first show it: no trailing zero dust. */
export function formatNumericEntryValue(value: number, step: number) {
  const decimals = stepDecimals(step);
  if (decimals === 0) return String(Math.round(value));
  return String(Number(value.toFixed(decimals)));
}

/**
 * Text to value. Out-of-range input clamps rather than erroring — typing 500
 * into a 0-100 control means "as high as it goes". The result is snapped to the
 * control's step so a typed value is always one a drag could also have made.
 * Unparseable text returns null, which the caller treats as a cancel.
 */
export function parseNumericEntry(text: string, { max, min, step }: { max: number; min: number; step: number }) {
  const parsed = Number.parseFloat(text.replace(",", ".").trim());
  if (!Number.isFinite(parsed)) return null;

  const granularity = decimalStepGranularity(step);
  const snapped = min + Math.round((clamp(parsed, min, max) - min) / granularity) * granularity;
  return Number(clamp(snapped, min, max).toFixed(12));
}

function NumericEntryPopover({ onClose, request }: { onClose: () => void; request: NumericEntryRequest }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const settledRef = useRef(false);
  const [text, setText] = useState(() => formatNumericEntryValue(request.value, request.step));
  const [placement, setPlacement] = useState<CSSProperties | null>(null);
  const editLock = useEditLock();

  // Held for as long as the popover is open, so a poll cannot reconcile the
  // control's value out from under the number being typed into it.
  const onCloseRef = useRef(request.onClose);
  onCloseRef.current = request.onClose;
  useEffect(() => {
    beginControlInteraction();
    const releaseKiosk = beginKioskTextEditing();
    return () => {
      releaseKiosk();
      endControlInteraction();
      onCloseRef.current?.();
    };
  }, []);

  const reposition = useCallback(() => {
    const card = cardRef.current;
    if (!card) return;

    const anchorRect = request.anchor.getBoundingClientRect();
    const { height, width } = card.getBoundingClientRect();
    const centreX = anchorRect.left + request.anchorOffsetX;
    const left = clamp(
      centreX - width / 2,
      EDGE_MARGIN_PX,
      Math.max(EDGE_MARGIN_PX, window.innerWidth - width - EDGE_MARGIN_PX),
    );
    const above = anchorRect.top - height - EDGE_MARGIN_PX;
    const top = above >= EDGE_MARGIN_PX
      ? above
      : Math.min(anchorRect.bottom + EDGE_MARGIN_PX, Math.max(EDGE_MARGIN_PX, window.innerHeight - height - EDGE_MARGIN_PX));

    setPlacement({ left, top });
  }, [request.anchor, request.anchorOffsetX]);

  useLayoutEffect(() => {
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [reposition]);

  // A layout effect, not a passive one: React commits a discrete event's update
  // synchronously, so focusing here stays inside the task the tap started. iOS
  // only raises its keyboard for a focus that a gesture can be traced to, and a
  // focus deferred to after paint cannot be.
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    // preventScroll: the anchor is already in view, and letting the browser
    // scroll to the portalled field would move the control out from under the
    // finger that just tapped it.
    input.focus({ preventScroll: true });
    input.select();
  }, []);

  const settle = useCallback((commit: boolean) => {
    if (settledRef.current) return;
    settledRef.current = true;
    if (commit) {
      const parsed = parseNumericEntry(text, request);
      if (parsed !== null && parsed !== request.value) request.onCommit(parsed);
    }
    onClose();
  }, [onClose, request, text]);

  // Touch commits by tapping away, which never produces a blur on some
  // browsers, so the outside press is watched directly.
  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      if (cardRef.current?.contains(event.target as Node)) return;
      settle(true);
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, [settle]);

  const hint = request.hint
    ?? `${formatNumericEntryValue(request.min, request.step)} – ${formatNumericEntryValue(request.max, request.step)}`;

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={request.label}
      className="cyber-numeric-entry"
      // Transparent rather than `visibility: hidden` for the frame before it is
      // measured: a hidden element cannot take focus, and the field must be
      // focused from inside the tap that opened it.
      style={{ left: 0, top: 0, ...placement, opacity: placement ? 1 : 0 }}
    >
      <span className="cyber-numeric-entry-label">{request.label}</span>
      <div className="cyber-numeric-entry-row">
        {request.min < 0 ? (
          <button
            type="button"
            className="cyber-numeric-entry-sign"
            aria-label="Toggle sign"
            // iOS's decimal keypad has no minus key, so a signed control is
            // otherwise unenterable on touch.
            onClick={() => {
              setText((current) => (current.startsWith("-") ? current.slice(1) : `-${current}`));
              inputRef.current?.focus({ preventScroll: true });
            }}
          >
            ±
          </button>
        ) : null}
        <input
          ref={inputRef}
          type="text"
          inputMode="decimal"
          pattern="-?[0-9]*[.,]?[0-9]*"
          autoComplete="off"
          aria-label={request.label}
          className="cyber-text-input cyber-numeric-entry-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onFocus={editLock.onFocus}
          onBlur={(event) => {
            editLock.onBlur();
            if (cardRef.current?.contains(event.relatedTarget as Node | null)) return;
            settle(true);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              settle(true);
            } else if (event.key === "Escape") {
              event.preventDefault();
              settle(false);
            }
          }}
        />
        <button type="button" className="cyber-numeric-entry-ok" onClick={() => settle(true)}>OK</button>
      </div>
      <span className="cyber-numeric-entry-range">{hint}</span>
    </div>
  );
}

/**
 * Owns the one popover a control may have open. Render `element` alongside the
 * control's own markup and call `open` from its tap handler.
 */
export function useNumericEntry() {
  const [request, setRequest] = useState<NumericEntryRequest | null>(null);
  const [target, setTarget] = useState<HTMLElement | null>(null);
  const modalTarget = useModalPortalTarget();

  // document is not available while server-rendering, so the portal host is
  // resolved after mount.
  useEffect(() => {
    setTarget(modalTarget?.current ?? document.body);
  }, [modalTarget]);

  const close = useCallback(() => setRequest(null), []);
  const open = useCallback((next: NumericEntryRequest) => setRequest(next), []);

  const element = request && target
    ? createPortal(<NumericEntryPopover key={request.label} onClose={close} request={request} />, target)
    : null;

  return { close, element, open };
}
