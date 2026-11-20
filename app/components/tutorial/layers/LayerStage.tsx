"use client";

import { X } from "lucide-react";
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DeviceTheme } from "../../accentColor";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { MODE_COOL_COLOUR, MODE_FAN_COLOUR, MODE_HEAT_COLOUR } from "../../temperatureEncoderModel";
import { LAYER_SETS, type LayerMethod, type LayerSetId } from "./catalogue";
import { copyLiveCanvas, frameFor, renderCards, type Frame } from "./renderCards";

/**
 * The tag each method wears. Four colours that stay distinct in every theme:
 * the theme's highlight, and the climate knob's fixed cool, heat and fan
 * colours (temperatureEncoderModel.ts).
 */
const METHOD_TAG: Record<LayerMethod, string> = { CSS: "css", SVG: "svg", "Canvas 2D": "canvas", WebGL: "webgl" };
const METHOD_COLOUR: Record<LayerMethod, string> = {
  CSS: "var(--cyber-highlight)",
  SVG: MODE_COOL_COLOUR,
  "Canvas 2D": MODE_HEAT_COLOUR,
  WebGL: MODE_FAN_COLOUR,
};

/** How far apart the cards sit along the stack, as a share of the card. */
const LIFT = 0.16;

type Props = {
  setId: LayerSetId;
  /** The control the layers come from (the copy's knob, or the real orb host). */
  control: Element | null;
  theme: DeviceTheme;
  onClose: () => void;
};

/**
 * "How was this control built?" (specs/tutorial-mode.md): the control's
 * layers, pre-rendered once each to a canvas, fanned apart in 3D like a stack
 * of cards. Tap (or hover) a card for why it is built that way; drag the stage
 * to turn the stack.
 */
export function LayerStage({ setId, control, theme, onClose }: Props) {
  const set = LAYER_SETS[setId];
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const rings = useMemo(() => document.querySelector(".rotary-encoder-ring-layer[data-portal-tag='tutorial']"), []);
  const frame = useMemo<Frame>(() => frameFor(set, control, rings), [control, rings, set]);
  const [empty, setEmpty] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [spread, setSpread] = useState(false);
  const [turn, setTurn] = useState(-35);
  const drag = useRef<{ x: number; turn: number } | null>(null);
  // Read once per opening: a theme change while open must not start a second
  // offscreen render (and a second WebGL context) under the first.
  const themeRef = useRef(theme);

  useEffect(() => {
    let alive = true;
    void renderCards(set, canvases.current, { control, rings, frame, theme: themeRef.current }).then((ids) => {
      if (!alive) return;
      setEmpty(ids);
      // One frame flat, then the 1s ease apart.
      requestAnimationFrame(() => requestAnimationFrame(() => alive && setSpread(true)));
    });
    return () => {
      alive = false;
    };
  }, [control, frame, rings, set]);

  // The orb's body is a live canvas: its card keeps moving while the view is open.
  useEffect(() => {
    const live = set.layers.find((layer) => layer.source.kind === "canvas");
    const source = live?.source.kind === "canvas" ? control?.querySelector<HTMLCanvasElement>(live.source.selector) : null;
    const card = live ? canvases.current.get(live.id) : null;
    if (!source || !card) return;
    let frameId = 0;
    const tick = () => {
      copyLiveCanvas(source, card, frame);
      frameId = requestAnimationFrame(tick);
    };
    frameId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frameId);
  }, [control, frame, set]);

  const shown = set.layers.filter((layer) => !empty?.has(layer.id));
  const narrow = typeof window !== "undefined" && window.innerWidth < 600;
  const fit = Math.min(window.innerWidth * (narrow ? 0.55 : 0.42), window.innerHeight * (narrow ? 0.26 : 0.42));
  const scale = fit / Math.max(frame.width, frame.height);
  const width = frame.width * scale;
  const height = frame.height * scale;
  const active = set.layers.find((layer) => layer.id === selected) ?? null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(".layer-card")) return;
    drag.current = { x: event.clientX, turn };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (drag.current) setTurn(drag.current.turn + (event.clientX - drag.current.x) * 0.3);
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  return (
    <div className="layer-stage" data-tutorial-ui="" data-tutorial-panel="" data-narrow={narrow ? "true" : undefined} role="dialog" aria-modal="true" aria-label={`How the ${set.title.toLowerCase()} is built`}>
      <header className="layer-stage-header">
        <h2 className="tutorial-title">{`How the ${set.title.toLowerCase()} is built`}</h2>
        <MomentaryFeedbackButton className="tutorial-close layer-stage-close" aria-label="Back to the tour" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </MomentaryFeedbackButton>
      </header>
      <div className="layer-stage-body" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="layer-stack" style={{ width, height, "--layer-turn": `${turn}deg` } as CSSProperties} data-spread={spread ? "true" : "false"}>
          {set.layers.map((layer) => {
            const index = shown.indexOf(layer);
            const hidden = empty === null ? false : index < 0;
            const style = {
              "--layer-lift": `${(spread ? index : 0) * height * LIFT + (layer.id === selected ? height * 0.08 : 0)}px`,
              display: hidden ? "none" : undefined,
            } as CSSProperties;
            return (
              <button
                key={layer.id}
                type="button"
                className="layer-card"
                aria-label={`${layer.name}, ${layer.method}`}
                data-selected={layer.id === selected ? "true" : undefined}
                style={style}
                onClick={() => setSelected(layer.id)}
                onPointerEnter={(event) => event.pointerType === "mouse" && setSelected(layer.id)}
                aria-pressed={layer.id === selected}
              >
                <canvas ref={(node) => { if (node) canvases.current.set(layer.id, node); }} className="layer-card-canvas" aria-hidden="true" />
              </button>
            );
          })}
        </div>
      </div>
      <aside className="layer-note">
        {/* Flat and readable, top of the stack first; the cards in 3D carry no text. */}
        <ol className="layer-list">
          {[...shown].reverse().map((layer) => (
            <li key={layer.id}>
              <button
                type="button"
                className="layer-list-item"
                data-selected={layer.id === selected ? "true" : undefined}
                onClick={() => setSelected(layer.id)}
                onPointerEnter={(event) => event.pointerType === "mouse" && setSelected(layer.id)}
              >
                <span className="layer-tag" data-method={METHOD_TAG[layer.method]} style={{ background: METHOD_COLOUR[layer.method] }}>{layer.method}</span>
                {layer.name}
              </button>
            </li>
          ))}
        </ol>
        <p className="layer-note-text" aria-live="polite">
          {active ? active.why : empty === null ? "Drawing each layer…" : "Tap a layer to see why it is built that way. Drag to turn the stack."}
        </p>
      </aside>
    </div>
  );
}
