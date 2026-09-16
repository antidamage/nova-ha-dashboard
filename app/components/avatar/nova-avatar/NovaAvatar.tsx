"use client";

import { useExperienceFeature } from "../../dashboard/experienceModeSetting";
import { useVoiceSpeechPhase } from "../../dashboard/voiceSpeech";
import { NovaAvatarVisual } from "./NovaAvatarVisual";
import type { NovaAvatarProps } from "./types";

// Status-orb feature gate: when the status orb is turned off the visual never
// mounts, so none of its hooks run — no theme/orb-module fetches, no 100 ms
// load poll, no gym-counter poll, no canvas animation loop. SSR still emits
// the markup (the server can't see localStorage); the head bootstrap in
// layout.tsx hides it via CSS (html[data-nova-lite] / html[data-nova-no-orb])
// before first paint and this gate unmounts it right after hydration. Config
// previews pass forceVisible and are never suppressed.
export default function NovaAvatar(props: NovaAvatarProps) {
  const showOrb = useExperienceFeature("statusOrb");
  const speechPhase = useVoiceSpeechPhase();
  if (!props.forceVisible && !showOrb) {
    // The voice agent's speaking orb appears on EVERY connected client, orb
    // feature setting included: while speech is live a centred speech-only
    // orb mounts (fading in/out in place instead of migrating), then unmounts
    // completely so opted-out devices pay nothing when Nova is quiet.
    if (speechPhase === "idle") {
      return null;
    }
    return <NovaAvatarVisual {...props} speechOnly />;
  }
  return <NovaAvatarVisual {...props} />;
}
