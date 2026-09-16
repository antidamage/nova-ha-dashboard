"use client";

import { Download, Image as ImageIcon, Trash2, Upload } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import {
  loadDesktopWallpapers,
  removeDesktopWallpaper,
  uploadDesktopWallpaper,
  type DesktopWallpaperAsset,
} from "../../desktop-wallpaper-client";
import type { DesktopWallpaperSettings } from "../../theme/accent/types";
import { formatBytes } from "./accent-config-model";

type DesktopWallpaperAssetSlot = "ipadAssetId" | "landscapeAssetId" | "portraitAssetId";

export function DesktopWallpaperControl({
  onChange,
  value,
}: {
  onChange: (value: DesktopWallpaperSettings) => void;
  value: DesktopWallpaperSettings;
}) {
  const landscapeInputRef = useRef<HTMLInputElement | null>(null);
  const portraitInputRef = useRef<HTMLInputElement | null>(null);
  const ipadInputRef = useRef<HTMLInputElement | null>(null);
  const [assets, setAssets] = useState<DesktopWallpaperAsset[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const valueRef = useRef(value);
  valueRef.current = value;

  const loadAssets = useCallback(async () => {
    try {
      setAssets(await loadDesktopWallpapers());
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to read desktop wallpapers");
    }
  }, []);

  useEffect(() => {
    void loadAssets();
  }, [loadAssets]);

  const assetById = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets]);

  const uploadFile = async (slot: DesktopWallpaperAssetSlot, file: File | null) => {
    if (!file) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const asset = await uploadDesktopWallpaper(file);
      setAssets((current) => [...current.filter((item) => item.id !== asset.id), asset]);
      onChange({ ...valueRef.current, [slot]: asset.id });
      setMessage("Desktop wallpaper uploaded");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to upload desktop wallpaper");
    } finally {
      setBusy(false);
      if (slot === "landscapeAssetId" && landscapeInputRef.current) {
        landscapeInputRef.current.value = "";
      }
      if (slot === "portraitAssetId" && portraitInputRef.current) {
        portraitInputRef.current.value = "";
      }
      if (slot === "ipadAssetId" && ipadInputRef.current) {
        ipadInputRef.current.value = "";
      }
    }
  };

  const removeFile = async (slot: DesktopWallpaperAssetSlot) => {
    const assetId = valueRef.current[slot];
    if (!assetId) {
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      const nextAssets = await removeDesktopWallpaper(assetId);
      setAssets(nextAssets);
      onChange({ ...valueRef.current, [slot]: null });
      setMessage("Desktop wallpaper removed");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Failed to remove desktop wallpaper");
    } finally {
      setBusy(false);
    }
  };

  const row = (
    slot: DesktopWallpaperAssetSlot,
    label: string,
    detail: string,
    inputRef: RefObject<HTMLInputElement | null>,
  ) => {
    const assetId = value[slot];
    const fallbackAsset = (slot === "portraitAssetId" || slot === "ipadAssetId") && !assetId
      ? assetById.get(value.landscapeAssetId ?? "")
      : null;
    const asset = assetById.get(assetId ?? "") ?? fallbackAsset ?? null;
    const dimensions = asset?.width && asset.height ? `${asset.width}x${asset.height}` : null;

    return (
      <div className="intensity-panel border border-cyan-300/30 bg-neutral-900/80 p-4">
        <div className="grid gap-4 md:grid-cols-[140px_minmax(0,1fr)_auto] md:items-center">
          <p className="text-sm font-black uppercase text-cyan-200">{label}</p>
          <div className="grid gap-1 font-mono text-sm font-black uppercase text-neutral-300">
            <span className="inline-flex items-center gap-2">
              <ImageIcon className="h-4 w-4" />
              {asset ? asset.name : detail}
            </span>
            {asset ? (
              <span className="text-xs text-neutral-500">
                {[dimensions, formatBytes(asset.size), fallbackAsset ? "landscape fallback" : null].filter(Boolean).join(" / ")}
              </span>
            ) : assetId ? (
              <span className="text-xs text-red-200">Wallpaper file unavailable</span>
            ) : null}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            {asset ? (
              <img
                alt=""
                className="h-11 w-11 border border-cyan-300/40 object-cover"
                src={asset.url}
              />
            ) : null}
            <input
              ref={inputRef}
              className="sr-only"
              type="file"
              accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
              onChange={(event) => void uploadFile(slot, event.target.files?.[0] ?? null)}
            />
            {asset ? (
              <a
                className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
                href={asset.url}
                download={asset.name}
              >
                <Download className="h-4 w-4" />
                Download
              </a>
            ) : null}
            <button
              className="inline-flex min-h-11 items-center gap-2 border border-cyan-300/60 px-4 py-2 text-sm font-black"
              type="button"
              onClick={() => inputRef.current?.click()}
              disabled={busy}
            >
              <Upload className="h-4 w-4" />
              {busy ? "Working" : "Upload"}
            </button>
            {assetId ? (
              <button
                className="inline-flex min-h-11 items-center gap-2 border border-red-400/60 px-4 py-2 text-sm font-black"
                type="button"
                onClick={() => void removeFile(slot)}
                disabled={busy}
              >
                <Trash2 className="h-4 w-4" />
                Remove
              </button>
            ) : null}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="grid gap-3">
      {row("landscapeAssetId", "Desktop", "No landscape wallpaper", landscapeInputRef)}
      {row("portraitAssetId", "Portrait", "No portrait wallpaper", portraitInputRef)}
      {row("ipadAssetId", "iPad", "No iPad wallpaper", ipadInputRef)}
      {message ? <p className="text-xs font-semibold text-cyan-100">{message}</p> : null}
    </div>
  );
}
