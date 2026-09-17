"use client";

import { FLOW_DEFAULT, FLOW_FACE, FLOW_PASSKEY } from "../../../../lib/authentik-flow";
import type { Mode } from "./types";

export const MODE_FLOW: Record<Mode, string> = {
  password: FLOW_DEFAULT,
  passkey: FLOW_PASSKEY,
  face: FLOW_FACE,
};

/**
 * Components this surface knows how to render. Anything else is a flow change
 * nobody told the UI about — see `unsupported` below, which links out rather
 * than showing a blank card.
 */
export const RENDERABLE = new Set([
  "ak-stage-identification",
  "ak-stage-password",
  "ak-stage-authenticator-validate",
  "ak-stage-access-denied",
]);
