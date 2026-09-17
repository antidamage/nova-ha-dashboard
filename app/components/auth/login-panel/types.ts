/** Shapes for the sign-in surface. Type-only; import directly. */

import type { CaptureSpec } from "../../face/capture/types";

export type Mode = "password" | "passkey" | "face";

export type LoginPanelProps = {
  /** Called with a validated same-origin path once a flow completes. */
  onSuccess: (next: string) => void;
  /** Rendered as a Cancel button when supplied (the modal supplies it). */
  onCancel?: () => void;
  /**
   * Raised while a BROWSER-OWNED prompt is on screen (the passkey picker).
   * The modal suspends its focus trap for the duration -- without that, the
   * trap pulls focus back out of the picker and Chromium never paints it.
   */
  onNativePrompt?: (active: boolean) => void;
  compact?: boolean;
  /**
   * How this surface captures a face, and therefore which gate the service
   * runs. Defaults to `standard` — a surface that does not opt in does not
   * change, which is the point of the default rather than an accident of it.
   *
   * `specs/login-surface.md` § Assigning profiles to surfaces owns which
   * surface gets which: the config-page modal is `quick`, and the standalone
   * `/login` page, being where every other site lands, stays `standard`.
   */
  capture?: CaptureSpec;
};
