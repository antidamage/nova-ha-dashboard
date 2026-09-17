/** Shapes shared by the face-capture package. Type-only; import directly. */

/**
 * What a surface asks for, and what the service will run because of it.
 *
 * The name is the contract: it travels to `/verify` and `/assert` as the
 * `profile` field, and the thresholds live server-side in `core.CAPTURE_PROFILES`
 * so that nothing here decides how hard the check is. This table only decides
 * how the browser captures.
 */
export type CaptureProfileName = "standard" | "quick" | "image";

export type CaptureSpec = {
  profile: CaptureProfileName;
  /** Clip length in ms. Only `standard` records a clip. */
  clipMs: number;
  /**
   * Set on streamed profiles (`quick`): stills go to `/api/face/frame` one at
   * a time until the service holds enough good ones, or this long after the
   * preview's first frame, whichever comes first.
   */
  streamGiveUpMs?: number;
};

/** Outcome of `streamFrames`: `reason` is set only when the service refused outright. */
export type StreamResult = { complete: boolean; reason: string | null };

export type FaceReasonDetail = {
  message: string;
  /** Stable reason string to show beside the message, or null to withhold it. */
  code: string | null;
};

export type CameraChoice = { deviceId: string; label: string };

/** One entry of `dashboard.kiosk.cameras` — the same ordered preference list
 * the kiosk witness daemon and the rotated preview both read. */
export type CameraPreference = { match: string; degrees?: number };

export type FaceCapture = {
  videoRef: React.MutableRefObject<HTMLVideoElement | null>;
  devices: CameraChoice[];
  deviceId: string;
  previewing: boolean;
  /**
   * `null` until mounted: `window` does not exist during the server render, and
   * guessing "secure" would flash a camera panel that cannot work.
   */
  secureContext: boolean | null;
  /** Resolves to an error message, or `null` on success. */
  openCamera: (requestedId?: string) => Promise<string | null>;
  /**
   * The capture this instance was configured for. Consumers post it as the
   * `profile` field so the service runs the gate the surface asked for; reading
   * it from here rather than restating it is what stops the two drifting.
   */
  capture: CaptureSpec;
  /**
   * One capture, in whatever form the profile calls for: a clip for
   * `standard`/`quick`, a single still for `image`. The field name the blob
   * must be posted under comes back with it, because that is the other half of
   * the same decision and separating them is how a still ends up posted as a
   * clip.
   */
  recordClip: () => Promise<{ blob: Blob; field: "clip" | "image" }>;
  /**
   * Streamed profiles only: post stills until the service holds enough good
   * frames, or the give-up time passes. Either way the caller then posts
   * `/assert` with no upload — the service judges what it held.
   */
  streamFrames: (nonce: string) => Promise<StreamResult>;
  /** A single JPEG frame from the live preview. `image` uses this. */
  captureStill: () => Promise<Blob>;
  stopStream: () => void;
};
