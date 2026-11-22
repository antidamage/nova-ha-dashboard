"use client";

import { X } from "lucide-react";
import { type CSSProperties, type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import type { DeviceTheme } from "../../accentColor";
import { MomentaryFeedbackButton } from "../../MomentaryFeedbackButton";
import { MODE_COOL_COLOUR, MODE_FAN_COLOUR, MODE_HEAT_COLOUR } from "../../temperatureEncoderModel";
import { LAYER_SETS, type LayerMethod, type LayerSetId } from "./catalogue";
import { clampTilt, DRAG_DEG_PER_PX, fitStack, SELECT_LIFT, TILT_DEG } from "./layerFit";
import { type OrbGroup, startOrbGroupLoop } from "./orbGroups";
import { frameFor, renderCards, type Frame } from "./renderCards";

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

type Props = {
  setId: LayerSetId;
  /** The control the layers come from (the copy's knob, or the real orb host). */
  control: Element | null;
  theme: DeviceTheme;
  /** A line shown before the note: what this example is (the aircon's Manual). */
  lead?: string;
  onClose: () => void;
};

/**
 * "How was this control built?" (specs/tutorial-mode.md): the control's
 * layers, pre-rendered once each to a canvas, fanned apart in 3D like a stack
 * of cards. Tap (or hover) a card for why it is built that way; drag the stage
 * sideways to turn the stack and up or down to tilt it, down to straight down.
 */
export function LayerStage({ setId, control, theme, lead, onClose }: Props) {
  const set = LAYER_SETS[setId];
  const canvases = useRef(new Map<string, HTMLCanvasElement>());
  const rings = useMemo(() => document.querySelector(".rotary-encoder-ring-layer[data-portal-tag='tutorial']"), []);
  const frame = useMemo<Frame>(() => frameFor(set, control, rings), [control, rings, set]);
  const [empty, setEmpty] = useState<Set<string> | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [spread, setSpread] = useState(false);
  const [turn, setTurn] = useState(-35);
  const [tilt, setTilt] = useState(TILT_DEG);
  const drag = useRef<{ x: number; y: number; turn: number; tilt: number } | null>(null);
  // Read once per opening: a theme change while open must not start a second
  // offscreen render (and a second WebGL context) under the first.
  const themeRef = useRef(theme);
  // The stage body's size, measured: the stack is sized to fit it, and
  // re-sized on every resize or rotation, so nothing ever scrolls.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  const [body, setBody] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const node = bodyRef.current;
    if (!node) return;
    const read = () => setBody({ width: node.clientWidth, height: node.clientHeight });
    read();
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(read) : null;
    observer?.observe(node);
    window.addEventListener("resize", read);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", read);
    };
  }, []);

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

  // The orb's body cards are drawn live, from one shared loop, while the view is open.
  useEffect(() => {
    const source = control?.querySelector<HTMLCanvasElement>(".nova-avatar-canvas");
    const cards = new Map<OrbGroup, HTMLCanvasElement>();
    for (const layer of set.layers) {
      const card = canvases.current.get(layer.id);
      if (layer.source.kind === "orb-group" && card) cards.set(layer.source.group, card);
    }
    if (!source || cards.size === 0) return;
    return startOrbGroupLoop(cards, source, frame, themeRef.current.avatar);
  }, [control, frame, set]);

  const shown = set.layers.filter((layer) => !empty?.has(layer.id));
  const narrow = body.width > 0 ? window.innerWidth < 600 : false;
  const fit = fitStack(frame, Math.max(1, shown.length), body, tilt);
  const { width, height } = fit.card;
  const active = set.layers.find((layer) => layer.id === selected) ?? null;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if ((event.target as Element).closest(".layer-card")) return;
    drag.current = { x: event.clientX, y: event.clientY, turn, tilt };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const start = drag.current;
    if (!start) return;
    // Sideways turns the stack, the near edge following the finger; down
    // brings the top toward the viewer, to straight down.
    setTurn(start.turn - (event.clientX - start.x) * DRAG_DEG_PER_PX);
    setTilt(clampTilt(start.tilt - (event.clientY - start.y) * DRAG_DEG_PER_PX));
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const stackStyle = {
    width,
    height,
    "--layer-turn": `${turn}deg`,
    "--layer-tilt": `${tilt}deg`,
    "--layer-shift": `${fit.shift.toFixed(1)}px`,
  } as CSSProperties;

  return (
    <div className="layer-stage" data-tutorial-ui="" data-tutorial-panel="" data-narrow={narrow ? "true" : undefined} role="dialog" aria-modal="true" aria-label={`How the ${set.title.toLowerCase()} is built`}>
      <header className="layer-stage-header">
        <h2 className="tutorial-title">{`How the ${set.title.toLowerCase()} is built`}</h2>
        <MomentaryFeedbackButton className="tutorial-close layer-stage-close" aria-label="Back to the tour" onClick={onClose}>
          <X className="h-4 w-4" aria-hidden="true" />
        </MomentaryFeedbackButton>
      </header>
      <div ref={bodyRef} className="layer-stage-body" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp}>
        <div className="layer-stack" style={stackStyle} data-spread={spread ? "true" : "false"}>
          {set.layers.map((layer) => {
            const index = shown.indexOf(layer);
            const hidden = empty === null ? false : index < 0;
            const style = {
              "--layer-lift": `${(spread ? index : 0) * fit.lift + (layer.id === selected ? height * SELECT_LIFT : 0)}px`,
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
        {lead ? <p className="layer-note-lead">{lead}</p> : null}
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
          {active ? active.why : empty === null ? "Drawing each layer…" : "Tap a layer to see why it is built that way. Drag sideways to turn the stack, up or down to tilt it."}
        </p>
      </aside>
    </div>
  );
}
