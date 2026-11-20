/**
 * One flag that silences UX sounds and haptics while something other than a
 * person is working a control: the tutorial's finger (specs/tutorial-mode.md,
 * "Quiet while it plays"). Off by default; nothing persists.
 */
let quiet = false;

export function setUxQuiet(next: boolean) {
  quiet = next;
}

export function isUxQuiet() {
  return quiet;
}
