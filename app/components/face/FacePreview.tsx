"use client";

import { useEffect, useState } from "react";

/**
 * The camera preview, turned the right way up.
 *
 * The kiosk's webcam is mounted on its side, so `getUserMedia` hands the page a
 * room lying on its back. The face service copes — it reads the eye landmarks
 * and rotates the clip upright before judging it, and logs
 * `clip arrived rotated; correcting by 3 quarter turn(s)` when it does — so
 * recognition was never actually broken by this. What was broken is that a
 * person trying to line their face up is looking at a sideways picture.
 *
 * **Preview only.** The recorded clip is left exactly as the camera produced
 * it. Rotating the pixels here as well would be work for nothing and would give
 * the service a second rotation to undo.
 *
 * The rule is keyed on a substring of the device LABEL, from
 * `dashboard.kiosk.cameraRotations`, because a rotation is a property of the
 * camera rather than of the page: the same rule then corrects that camera
 * wherever it is seen, and leaves every other camera alone. No host, no device
 * path, nothing machine-specific in this repo.
 */

export type CameraRotationRule = { match: string; degrees: 0 | 90 | 180 | 270 };

let cachedRules: CameraRotationRule[] | null = null;

async function loadRules(): Promise<CameraRotationRule[]> {
  if (cachedRules) return cachedRules;
  try {
    const response = await fetch("/api/config/client", { cache: "no-store" });
    if (!response.ok) return (cachedRules = []);
    const body = (await response.json()) as {
      dashboard?: { kiosk?: { cameraRotations?: CameraRotationRule[] } };
    };
    cachedRules = body.dashboard?.kiosk?.cameraRotations ?? [];
  } catch {
    // A preview that is merely the wrong way up is not worth failing over.
    cachedRules = [];
  }
  return cachedRules;
}

export function rotationForLabel(label: string, rules: CameraRotationRule[]): number {
  if (!label) return 0;
  const lower = label.toLowerCase();
  const rule = rules.find((entry) => entry.match && lower.includes(entry.match.toLowerCase()));
  return rule ? ((rule.degrees % 360) + 360) % 360 : 0;
}

export function useCameraRotation(label: string | undefined): number {
  const [rules, setRules] = useState<CameraRotationRule[] | null>(cachedRules);
  useEffect(() => {
    let live = true;
    void loadRules().then((next) => {
      if (live) setRules(next);
    });
    return () => {
      live = false;
    };
  }, []);
  return rotationForLabel(label ?? "", rules ?? []);
}

/**
 * A quarter turn swaps the video's axes, so the element is sized to the box's
 * OPPOSITE dimension before being rotated about its centre: 16/9 of the box
 * width becomes the box height, and 9/16 of the box height becomes its width.
 * That fills the frame exactly, with no measurement and no letterboxing.
 */
function rotatedStyle(degrees: number): React.CSSProperties {
  const quarter = degrees === 90 || degrees === 270;
  return {
    position: "absolute",
    top: "50%",
    left: "50%",
    width: quarter ? "177.78%" : "100%",
    height: quarter ? "56.25%" : "100%",
    objectFit: "cover",
    transform: `translate(-50%, -50%) rotate(${degrees}deg)`,
  };
}

export function FacePreview({
  ariaLabel,
  label,
  previewing,
  videoRef,
}: {
  ariaLabel: string;
  /** The active device's label, matched against the rotation rules. */
  label?: string;
  previewing: boolean;
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
}) {
  const degrees = useCameraRotation(label);
  const quarter = degrees === 90 || degrees === 270;

  return (
    <div
      className="relative w-full overflow-hidden border border-neutral-800 bg-black"
      // A sideways camera is a portrait camera once corrected, so the box
      // follows it rather than pillarboxing the person into a letterbox.
      style={{ aspectRatio: quarter ? "9 / 16" : "16 / 9" }}
    >
      <video
        ref={videoRef}
        className="bg-black"
        style={rotatedStyle(degrees)}
        muted
        playsInline
        aria-label={ariaLabel}
      />
      {!previewing ? (
        <p className="absolute inset-0 flex items-center justify-center text-xs uppercase tracking-widest text-neutral-500">
          Camera off
        </p>
      ) : null}
    </div>
  );
}
