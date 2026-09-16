"use client";

import { Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { SliderControlPanel } from "../../ConfigControls";
import { FLUID_BACKGROUND_TEXTURE_SCALE_MAX, FLUID_BACKGROUND_TEXTURE_SCALE_MIN } from "../../accentColor";
import {
  loadBackgroundTextureStatus,
  removeBackgroundTexture,
  uploadBackgroundTexture,
  type BackgroundTextureStatus,
} from "../../background-texture-client";
import type { FluidBackgroundSettings } from "../../theme/accent/types";
import { formatBytes } from "./accent-config-model";

export function BackgroundTextureControl({
  accentColor,
  highlightColor,
  onChange,
  onPreview,
  value,
}: {
  accentColor: [number, number, number];
  highlightColor: [number, number, number];
  onChange: (value: FluidBackgroundSettings) => void;
  onPreview: (value: FluidBackgroundSettings) => void;
  value: FluidBackgroundSettings;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [status, setStatus] = useState<BackgroundTextureStatus | null>(null);
  const valueRef = useRef(value);
  const active = Boolean(value.textureUrl);
  valueRef.current = value;

  const loadStatus = useCallback(async () => {
    try {
      setStatus(await loadBackgroundTextureStatus());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read background texture");
    }
  }, []);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  const uploadFile = async (file: File | null) => {
    if (!file) {
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await uploadBackgroundTexture(file);
      setStatus(nextStatus);
      onChange({ ...valueRef.current, textureUrl: nextStatus.url ?? "/api/background-texture" });
      setMessage("Texture uploaded");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload background texture");
    } finally {
      setBusy(false);
      if (inputRef.current) {
        inputRef.current.value = "";
      }
    }
  };

  const removeFile = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const nextStatus = await removeBackgroundTexture();
      setStatus(nextStatus);
      onChange({ ...valueRef.current, textureUrl: null });
      setMessage("Texture removed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove background texture");
    } finally {
      setBusy(false);
    }
  };

  const dimensions = status?.width && status?.height ? `${status.width}x${status.height}` : null;

  return (
    <div className="grid gap-3">
      <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
        <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center">
          <p className="text-sm font-black uppercase text-cyan-200">Texture Map</p>
          <div className="grid gap-1 font-mono text-sm font-black uppercase text-neutral-300">
            <span className="inline-flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {active ? "Texture active" : "No texture"}
            </span>
            {status?.exists ? (
              <span className="text-xs text-neutral-500">
                {[dimensions, formatBytes(status.size)].filter(Boolean).join(" / ")}
                {status.updatedAt ? ` / ${new Date(status.updatedAt).toLocaleString()}` : ""}
              </span>
            ) : active ? (
              <span className="text-xs text-red-200">Texture file unavailable</span>
            ) : null}
            {message ? <span className="text-xs text-cyan-100">{message}</span> : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {value.textureUrl ? (
              <img
                alt=""
                className="h-11 w-11 border border-cyan-300/40 object-cover"
                src={value.textureUrl}
              />
            ) : null}
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              onChange={(event) => void uploadFile(event.target.files?.[0] ?? null)}
            />
            <button
              className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              {busy ? "Working" : "Upload"}
            </button>
            {active ? (
              <button
                className="inline-flex min-h-11 items-center gap-2 border border-red-400/60 px-4 py-2 text-sm font-black"
                type="button"
                onClick={() => void removeFile()}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
      <SliderControlPanel
        activeColor={highlightColor}
        ariaLabel="Background texture scale"
        ariaValueText={`${(value.textureScale / 100).toFixed(2)}x`}
        color={accentColor}
        intensity={Math.min(100, Math.max(40, value.textureScale))}
        label="Texture Scale"
        max={FLUID_BACKGROUND_TEXTURE_SCALE_MAX}
        min={FLUID_BACKGROUND_TEXTURE_SCALE_MIN}
        step={0.01}
        value={value.textureScale}
        valueText={`${(value.textureScale / 100).toFixed(2)}x`}
        onPreview={(textureScale) => onPreview({ ...valueRef.current, textureScale })}
        onCommit={(textureScale) => onChange({ ...valueRef.current, textureScale })}
      />
    </div>
  );
}
