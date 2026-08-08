"use client";

import { Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";

import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";

/**
 * The tile that is actually assigned.
 *
 * `centre-image-tile-selected` is defined in globals.css and draws a solid ring
 * in the theme's highlight colour. Deliberately not Tailwind's `ring-*`: nothing
 * else on this surface uses those utilities and they rendered nothing here, so
 * the selection was invisible — which is the exact class of bug
 * `styling.contract.test.ts` exists to catch.
 */
const SELECTED_RING = "centre-image-tile-selected";
import {
  deleteCentreImage,
  loadCentreImages,
  uploadCentreImage,
  type CentreImage,
  type CentreImageSlot,
} from "./centre-image-client";

/**
 * An image library: upload a picture, pick one, throw one away.
 *
 * A history rather than a single slot, so an image used last month can be put
 * back without finding the file again. `slot` says WHICH library — the centre
 * and the background keep separate ones, so a centrepiece never turns up in the
 * backdrop picker.
 *
 * Deleting an image still referenced by the configuration is refused by the API
 * rather than cascading, and the reason it gives names the referrer.
 */
export function CentreImageLibrary({
  emptyLabel = "None",
  onSelect,
  selectedId,
  slot,
}: {
  /** What the "nothing selected" tile reads as in this context. */
  emptyLabel?: string;
  onSelect: (id: string | null) => void;
  selectedId: string | null;
  slot: CentreImageSlot;
}) {
  const [images, setImages] = useState<CentreImage[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      setImages(await loadCentreImages(slot));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to load the image library");
    }
  }, [slot]);

  useEffect(() => { void refresh(); }, [refresh]);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    setMessage("");
    try {
      const added = await uploadCentreImage(file, slot);
      await refresh();
      // Uploading is always in order to use it, so selecting it is the answer
      // rather than making it a second step.
      onSelect(added.id);
      if (!added.hasAlpha) {
        setMessage("That PNG has no transparency, so it will cover a solid rectangle.");
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload the image");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  const remove = async (image: CentreImage) => {
    setBusy(true);
    setMessage("");
    try {
      setImages(await deleteCentreImage(image.id, slot));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove the image");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-2">
      {/* The gap is wide enough for the selected tile's ring to sit in without
          touching its neighbours. */}
      <div className="flex flex-wrap gap-4">
        <button
          type="button"
          aria-pressed={selectedId === null}
          className={`flex h-20 w-20 items-center justify-center rounded border px-1 text-center text-xs ${
            selectedId === null
              ? `${SELECTED_RING} text-cyan-200`
              : "border-neutral-800 text-neutral-500"
          }`}
          onClick={() => onSelect(null)}
        >
          {emptyLabel}
        </button>

        {images.map((image) => (
          <div key={image.id} className="relative">
            <button
              type="button"
              aria-label={`Use ${image.name}`}
              aria-pressed={selectedId === image.id}
              title={`${image.name} · ${image.width}×${image.height}`}
              className={`flex h-20 w-20 items-center justify-center overflow-hidden rounded border ${
                selectedId === image.id ? SELECTED_RING : "border-neutral-800"
              }`}
              onClick={() => onSelect(image.id)}
            >
              {/* Deliberately a plain img: these are user uploads served by our
                  own route, already sized, and next/image would only add a
                  second copy of every one of them on disk. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                alt={image.name}
                src={image.url}
                className="max-h-full max-w-full object-contain"
              />
            </button>
            {image.hasAlpha ? null : (
              // Permanent, not a one-shot message at upload time. A PNG with no
              // alpha channel draws as a solid rectangle in the picture, and
              // without this the only symptom is "why is there a white box
              // behind my logo" long after the upload that caused it.
              <span
                className="absolute -bottom-1 -left-1 rounded bg-amber-500/90 px-1 text-[10px] font-black text-neutral-950"
                title={`${image.name} has no transparency, so it draws as a solid rectangle.`}
              >
                NO ALPHA
              </span>
            )}
            <MomentaryFeedbackButton
              type="button"
              className="icon-link absolute -right-1 -top-1 text-red-200"
              aria-label={`Delete ${image.name}`}
              disabled={busy}
              onClick={() => remove(image)}
            >
              <Trash2 className="h-4 w-4" />
            </MomentaryFeedbackButton>
          </div>
        ))}
      </div>

      <input
        ref={input}
        type="file"
        accept="image/png,.png"
        className="hidden"
        onChange={(event) => void upload(event.target.files?.[0])}
      />
      <MomentaryFeedbackButton
        type="button"
        className="config-page-button justify-center"
        disabled={busy}
        onClick={() => input.current?.click()}
      >
        <Upload className="h-4 w-4" />
        <span>Upload PNG</span>
      </MomentaryFeedbackButton>

      {message ? <p className="text-xs text-amber-300">{message}</p> : null}
    </div>
  );
}
