"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  readStoredExperienceMode,
  writeExperienceModeSetting,
  type ExperienceMode,
} from "./dashboard/experienceModeSetting";
import { useAgentName } from "./AgentNameContext";

// First-run experience chooser. Devices that have never chosen an experience
// mode (no stored key) are asked once; the answer is written to localStorage
// and the modal never appears again on that device. There is deliberately no
// outside-click dismiss and no close button: a choice is required, otherwise
// "ask once" cannot be honoured.
//
// Renders nothing on the server and on the first client render — the stored
// mode is read in an effect so server markup always matches hydration (see
// SPEC.md hydration rule). Decided devices therefore never see a flash of
// the modal.
export function ExperienceModeModal() {
  const { agentName } = useAgentName();
  const [pending, setPending] = useState(false);
  const richButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setPending(readStoredExperienceMode() === null);
  }, []);

  useEffect(() => {
    if (pending) {
      richButtonRef.current?.focus();
    }
  }, [pending]);

  if (!pending || typeof document === "undefined") {
    return null;
  }

  const choose = (mode: ExperienceMode) => {
    writeExperienceModeSetting(mode);
    setPending(false);
  };

  return createPortal(
    <div className="system-confirm-overlay experience-mode-overlay" role="presentation">
      <div
        className="system-confirm-card experience-mode-card"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="experience-mode-title"
        aria-describedby="experience-mode-body"
      >
        <span className="system-stripe system-stripe-top" aria-hidden="true" />
        <span className="system-stripe system-stripe-bottom" aria-hidden="true" />
        <h3 id="experience-mode-title" className="system-confirm-title">
          Choose your experience
        </h3>
        <div id="experience-mode-body" className="system-confirm-body">
          <p>{agentName} can run in two modes on this device.</p>
          <p>
            <strong>Full Experience</strong> — animated background, status orb, and full visual
            effects. Best on recent hardware.
          </p>
          <p>
            <strong>Lite</strong> — the same features with heavy visuals reduced for fast, smooth
            performance.
          </p>
        </div>
        <div className="system-confirm-actions">
          <button type="button" className="system-confirm-cancel" onClick={() => choose("lite")}>
            Lite
          </button>
          <button
            ref={richButtonRef}
            type="button"
            className="system-confirm-go"
            onClick={() => choose("rich")}
          >
            Full Experience
          </button>
        </div>
        <p className="system-confirm-dismiss-hint">
          You can change this anytime in Config under “This Device”.
        </p>
      </div>
    </div>,
    document.body,
  );
}
