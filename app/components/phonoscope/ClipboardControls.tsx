"use client";

import { ClipboardPaste, Copy, CopyPlus } from "lucide-react";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import {
  usePhonoscopeClipboard,
  type PhonoscopeClipboardKind,
  type PhonoscopeClipboardPayloads,
} from "./clipboard";

/**
 * The copy/duplicate pair that sits in a node's accordion header.
 *
 * Icons match the dashboard theme library: `CopyPlus` duplicates in place,
 * `Copy` puts the subtree on the clipboard for pasting over another node.
 */
export function CopyActions<K extends PhonoscopeClipboardKind>({
  kind,
  label,
  onDuplicate,
  payload,
}: {
  kind: K;
  label: string;
  onDuplicate: () => void;
  payload: PhonoscopeClipboardPayloads[K];
}) {
  const clipboard = usePhonoscopeClipboard();
  return (
    <>
      <MomentaryFeedbackButton
        type="button"
        className="icon-link"
        aria-label={`Duplicate ${label}`}
        title={`Duplicate ${label}`}
        onClick={onDuplicate}
      >
        <CopyPlus className="h-4 w-4" />
      </MomentaryFeedbackButton>
      <MomentaryFeedbackButton
        type="button"
        className="icon-link"
        aria-label={`Copy ${label}`}
        title={`Copy ${label}`}
        onClick={() => clipboard.copy(kind, label, payload)}
      >
        <Copy className="h-4 w-4" />
      </MomentaryFeedbackButton>
    </>
  );
}

/**
 * Paste over *this* node, replacing its settings with the clipboard's.
 *
 * It is always rendered and disabled when it cannot accept what is held, so the
 * places a copy can land are visible before you go looking for them. `accepts`
 * is what makes an effect binding stricter than its kind: a copied "Strong beat
 * multiplier" can only land on another Strong beat multiplier, because its
 * range and envelope mean nothing on a different setting.
 */
export function PasteIntoButton<K extends PhonoscopeClipboardKind>({
  accepts,
  kind,
  onPaste,
  what,
}: {
  accepts?: (payload: PhonoscopeClipboardPayloads[K]) => boolean;
  kind: K;
  onPaste: (payload: PhonoscopeClipboardPayloads[K]) => void;
  what: string;
}) {
  const clipboard = usePhonoscopeClipboard();
  const held = clipboard.item?.kind === kind
    ? (clipboard.item.payload as PhonoscopeClipboardPayloads[K])
    : null;
  const compatible = held !== null && (accepts?.(held) ?? true);
  const title = !clipboard.item
    ? "Nothing copied yet"
    : compatible
      ? `Replace this ${what} with “${clipboard.item.label}”`
      : `“${clipboard.item.label}” cannot be pasted into a ${what}`;

  return (
    <MomentaryFeedbackButton
      type="button"
      className="theme-library-button justify-center"
      disabled={!compatible}
      title={title}
      onClick={() => {
        // Re-ided on the way out, so pasting twice never links the two copies.
        const payload = clipboard.take(kind);
        if (payload) onPaste(payload);
      }}
    >
      <ClipboardPaste className="h-4 w-4" />
      {compatible && clipboard.item ? `Paste “${clipboard.item.label}”` : `Paste ${what}`}
    </MomentaryFeedbackButton>
  );
}
