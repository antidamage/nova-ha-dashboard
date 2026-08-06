"use client";

import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";

/**
 * Solo: hold the visualiser on one colour theme or one settings group.
 *
 * The lock is resolved in `readPhonoscopeThemeState`, which is the object both
 * engines already follow, so soloing reaches the streamed renderer and the tvOS
 * fallback without either of them knowing the feature exists.
 */
export type SoloState = {
  colorThemeId: string;
  settingsGroupId: string;
};

/** The square "S". Toggles, and reads as latched when it is on. */
export function SoloButton({
  active,
  label,
  onToggle,
}: {
  active: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <MomentaryFeedbackButton
      type="button"
      className={`phonoscope-solo-button${active ? " is-soloed" : ""}`}
      aria-pressed={active}
      aria-label={active ? `Stop soloing ${label}` : `Solo ${label}`}
      title={active ? `Stop soloing ${label}` : `Solo ${label}`}
      onClick={(event) => {
        // The button lives in an accordion header, whose click toggles the
        // section. Soloing must not also open or close it.
        event.stopPropagation();
        onToggle();
      }}
    >
      S
    </MomentaryFeedbackButton>
  );
}

/**
 * The floating reminder that something is held.
 *
 * Solo survives scrolling away and reloading, so without this it is possible to
 * leave the visualiser locked and not know why it stopped rotating. Colour theme
 * first, then settings, stacked with a 1px gap.
 */
export function SoloIndicator({
  colorThemeName,
  settingsGroupName,
  onClearColorTheme,
  onClearSettingsGroup,
}: {
  colorThemeName: string;
  settingsGroupName: string;
  onClearColorTheme: () => void;
  onClearSettingsGroup: () => void;
}) {
  if (!colorThemeName && !settingsGroupName) return null;
  return (
    <div className="phonoscope-solo-indicator" role="status" aria-live="polite">
      {colorThemeName ? (
        <MomentaryFeedbackButton
          type="button"
          className="phonoscope-solo-button is-soloed phonoscope-solo-chip"
          aria-label={`Stop soloing ${colorThemeName}`}
          title={`Soloing ${colorThemeName} — tap to release`}
          onClick={onClearColorTheme}
        >
          {colorThemeName}
        </MomentaryFeedbackButton>
      ) : null}
      {settingsGroupName ? (
        <MomentaryFeedbackButton
          type="button"
          className="phonoscope-solo-button is-soloed phonoscope-solo-chip"
          aria-label={`Stop soloing ${settingsGroupName}`}
          title={`Soloing ${settingsGroupName} — tap to release`}
          onClick={onClearSettingsGroup}
        >
          {settingsGroupName}
        </MomentaryFeedbackButton>
      ) : null}
    </div>
  );
}
