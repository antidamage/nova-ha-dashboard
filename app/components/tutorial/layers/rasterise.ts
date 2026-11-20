"use client";

/**
 * Pre-renders one layer of a live control into a 2D canvas, once, for the
 * layer view (specs/tutorial-mode.md, "How was this control built?").
 *
 * The control's subtree is cloned with every computed style written inline
 * (pseudo-elements become real spans), every element except the layer and
 * its ancestors is hidden, and the result is drawn through an SVG
 * foreignObject image. What a browser cannot paint inside an image (a
 * backdrop-filter, an SVG filter by url) comes out flat; the paragraph says
 * what the live layer does.
 */

const SVG_NS = "http://www.w3.org/2000/svg";
const XHTML_NS = "http://www.w3.org/1999/xhtml";

function copyStyle(from: CSSStyleDeclaration, to: CSSStyleDeclaration) {
  for (let index = 0; index < from.length; index += 1) {
    const name = from[index];
    to.setProperty(name, from.getPropertyValue(name), from.getPropertyPriority(name));
  }
}

function pseudoSpan(element: Element, pseudo: "::before" | "::after"): HTMLElement | null {
  const style = getComputedStyle(element, pseudo);
  if (!style.content || style.content === "none" || style.content === "normal") return null;
  const span = document.createElement("span");
  copyStyle(style, span.style);
  const text = style.content.replace(/^["']|["']$/g, "");
  if (text && !/^(url|counter|attr)\(/.test(style.content)) span.textContent = text;
  return span;
}

/**
 * A deep clone with computed styles inlined, and pseudo-elements made real.
 * Clones of elements `mark` accepts carry `data-layer-keep`.
 */
export function inlineClone(source: Element, mark: (element: Element) => boolean = () => false): Element {
  const clone = source.cloneNode(false) as Element;
  if (mark(source)) clone.setAttribute("data-layer-keep", "");
  if (clone instanceof HTMLElement || clone instanceof SVGElement) copyStyle(getComputedStyle(source), clone.style);
  if (source instanceof HTMLElement) {
    const before = pseudoSpan(source, "::before");
    if (before) clone.appendChild(before);
  }
  for (const child of Array.from(source.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) clone.appendChild(child.cloneNode());
    else if (child.nodeType === Node.ELEMENT_NODE) clone.appendChild(inlineClone(child as Element, mark));
  }
  if (source instanceof HTMLElement) {
    const after = pseudoSpan(source, "::after");
    if (after) clone.appendChild(after);
  }
  return clone;
}

/**
 * Hides everything in `root` except the elements matching `keep`, their
 * descendants, and their ancestors (which stay laid out but unpainted).
 */
export function isolate(root: Element, keep: (element: Element) => boolean) {
  const show = (element: Element) => {
    (element as HTMLElement | SVGElement).style?.setProperty("visibility", "visible");
    for (const child of Array.from(element.children)) show(child);
  };
  const walk = (element: Element): boolean => {
    if (keep(element)) {
      // The live control may be hidden under its tutorial copy: the layer is not.
      show(element);
      return true;
    }
    let holds = false;
    for (const child of Array.from(element.children)) holds = walk(child) || holds;
    const style = (element as HTMLElement | SVGElement).style;
    if (!style) return holds;
    if (holds) {
      // An ancestor of the layer: keep its box, drop its own paint.
      style.setProperty("background", "none");
      style.setProperty("box-shadow", "none");
      style.setProperty("border-color", "transparent");
      style.setProperty("filter", "none");
      style.setProperty("color", "transparent");
      style.setProperty("visibility", "visible");
    } else {
      style.setProperty("visibility", "hidden");
    }
    return holds;
  };
  walk(root);
}

/**
 * Draws the clone into `canvas` at the device pixel ratio. Resolves false if
 * the browser refused the image; the card then shows a live copy instead.
 */
export async function drawClone(clone: Element, width: number, height: number, canvas: HTMLCanvasElement): Promise<boolean> {
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.max(1, Math.round(width * dpr));
  canvas.height = Math.max(1, Math.round(height * dpr));
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("xmlns", SVG_NS);
  svg.setAttribute("width", String(width));
  svg.setAttribute("height", String(height));
  const object = document.createElementNS(SVG_NS, "foreignObject");
  object.setAttribute("width", "100%");
  object.setAttribute("height", "100%");
  const wrapper = document.createElementNS(XHTML_NS, "div");
  wrapper.setAttribute("style", `position:relative;width:${width}px;height:${height}px;`);
  wrapper.appendChild(clone);
  object.appendChild(wrapper);
  svg.appendChild(object);
  const markup = new XMLSerializer().serializeToString(svg);
  const url = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = new Image();
    image.decoding = "async";
    image.src = url;
    // A card that will not decode is left out rather than holding up the rest.
    await Promise.race([
      image.decode(),
      new Promise((_, reject) => window.setTimeout(() => reject(new Error("decode timeout")), 3000)),
    ]);
    const ctx = canvas.getContext("2d");
    if (!ctx) return false;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.drawImage(image, 0, 0, width, height);
    return true;
  } catch {
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/**
 * One layer of `root` (matching `selector`), positioned as it is on the page
 * relative to `frame`, drawn into `canvas`.
 */
export async function rasteriseLayer(root: Element, selector: string, frame: DOMRect, canvas: HTMLCanvasElement): Promise<boolean> {
  const clone = inlineClone(root, (element) => element.matches(selector)) as HTMLElement | SVGElement;
  const rect = root.getBoundingClientRect();
  clone.style.setProperty("position", "absolute");
  clone.style.setProperty("left", `${rect.left - frame.left}px`);
  clone.style.setProperty("top", `${rect.top - frame.top}px`);
  clone.style.setProperty("margin", "0");
  clone.style.setProperty("visibility", "visible");
  isolate(clone, (element) => element.hasAttribute("data-layer-keep"));
  return drawClone(clone, frame.width, frame.height, canvas);
}
