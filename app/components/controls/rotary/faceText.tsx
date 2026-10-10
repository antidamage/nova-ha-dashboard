// Knob face text with its decimal part at half size, top-aligned
// (specs/temperature-encoder.md, "Face"). `22.5` prints a full-size `22` and a
// half-size `.5` standing along the top of the digits; anything that is not a
// plain decimal number prints as it is.

export const FACE_DECIMAL_CLASS = "rotary-encoder-decimal";

/** `["22", ".5"]` for `22.5`; null for a whole number, `--` or any other text. */
export function splitDecimal(text: string): [string, string] | null {
  const match = /^(-?\d+)(\.\d+)$/.exec(text);
  return match ? [match[1], match[2]] : null;
}

export function FaceText({ text, decimals = false }: { text: string; decimals?: boolean }) {
  const parts = decimals ? splitDecimal(text) : null;
  if (!parts) return <>{text}</>;
  return (
    <>
      {parts[0]}
      <span className={FACE_DECIMAL_CLASS}>{parts[1]}</span>
    </>
  );
}

/** The same markup built on a DOM node, for measuring text the way it will print. */
export function setFaceTextContent(node: HTMLElement, text: string, decimals: boolean) {
  const parts = decimals ? splitDecimal(text) : null;
  if (!parts) {
    node.textContent = text;
    return;
  }
  const decimal = document.createElement("span");
  decimal.className = FACE_DECIMAL_CLASS;
  decimal.textContent = parts[1];
  node.replaceChildren(parts[0], decimal);
}
