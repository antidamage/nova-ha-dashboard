// The twelve UX sound actions and their per-theme assignment map.
//
// An assignment is a library sound id, the sentinel BUTTON_PRESS_SOUND (the
// theme's own uploaded control sound, and the default for most actions), or
// null for silence. No audio bytes live here — see specs/ux-sounds.md.

/** Resolves at playback time to the theme's `controlSound` clip. */
export const BUTTON_PRESS_SOUND = "button-press";
/** `timerAlert`'s default: the theme's existing timerSound chime. */
export const TIMER_CHIME_SOUND = "timer-chime";
/** `reminderAlert`'s default: the uploaded reminder MP3. */
export const REMINDER_AUDIO_SOUND = "reminder-audio";

/** Assignment order, which is also the order of the config rows. */
export const UX_SOUND_ACTIONS = [
  "unlockDial",
  "dialClick",
  "foldBreak",
  "foldHeal",
  "sectionChange",
  "buttonPress",
  "timerAlert",
  "reminderAlert",
  "reminderConfirm",
  "timerSet",
  "lightsOn",
  "lightsOff",
] as const;

export type UxSoundAction = (typeof UX_SOUND_ACTIONS)[number];

/** null = None. Any other string is a sound id or one of the sentinels above. */
export type UxSoundAssignments = Record<UxSoundAction, string | null>;

export const UX_SOUND_ACTION_LABELS: Record<UxSoundAction, string> = {
  unlockDial: "Unlock dial",
  dialClick: "Dial click",
  foldBreak: "Advanced fold break",
  foldHeal: "Advanced fold heal",
  sectionChange: "Section change",
  buttonPress: "Button press",
  timerAlert: "Timer alert",
  reminderAlert: "Reminder alert",
  reminderConfirm: "Reminder confirmation",
  timerSet: "Timer set",
  lightsOn: "Lights on",
  lightsOff: "Lights off",
};

// Everything defaults to the button-press sound the dashboard already played,
// except the two that already had a deliberate sound of their own: replacing
// those with a click would quietly disable the timer chime and the reminder
// MP3 (specs/ux-sounds.md, "Defaults").
export const DEFAULT_UX_SOUNDS: UxSoundAssignments = {
  unlockDial: BUTTON_PRESS_SOUND,
  dialClick: BUTTON_PRESS_SOUND,
  foldBreak: BUTTON_PRESS_SOUND,
  foldHeal: BUTTON_PRESS_SOUND,
  sectionChange: BUTTON_PRESS_SOUND,
  buttonPress: BUTTON_PRESS_SOUND,
  timerAlert: TIMER_CHIME_SOUND,
  reminderAlert: REMINDER_AUDIO_SOUND,
  reminderConfirm: BUTTON_PRESS_SOUND,
  timerSet: BUTTON_PRESS_SOUND,
  lightsOn: BUTTON_PRESS_SOUND,
  lightsOff: BUTTON_PRESS_SOUND,
};

const ACTION_SET = new Set<string>(UX_SOUND_ACTIONS);

export function isUxSoundAction(value: string): value is UxSoundAction {
  return ACTION_SET.has(value);
}

/**
 * Fill every action with its default and drop anything that is not one of the
 * twelve. A theme saved before this feature reads back as a complete default
 * map, which is the whole of the migration.
 */
export function normalizeUxSounds(value: unknown): UxSoundAssignments {
  const source = value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};

  const result = { ...DEFAULT_UX_SOUNDS };
  for (const action of UX_SOUND_ACTIONS) {
    if (!(action in source)) {
      continue;
    }
    const assigned = source[action];
    if (assigned === null) {
      result[action] = null;
    } else if (typeof assigned === "string" && assigned.trim()) {
      result[action] = assigned.trim().slice(0, 60);
    }
  }
  return result;
}
