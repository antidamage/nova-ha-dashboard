// The twelve UX sound actions and their per-theme assignment map.
//
// An assignment is a library sound id, the sentinel REMINDER_AUDIO_SOUND (the
// server-stored reminder MP3, configured under Reminders), or null for
// silence. No audio bytes live here — see specs/ux-sounds.md.

/** `reminderAlert`'s default: the uploaded reminder MP3. */
export const REMINDER_AUDIO_SOUND = "reminder-audio";

/**
 * Retired sentinels. `button-press` meant "the theme's own uploaded control
 * sound" and `timer-chime` meant "the theme's timer-sound selection"; both of
 * those fields are gone and every assignment is now a library id. A theme
 * written before that still carries them, so they are migrated on read — on
 * the server by `lib/sound-migration.ts`, which imports the uploaded clip into
 * the library, and here as the fallback for a theme that never went through it
 * (a preset JSON, a shared config from an older host).
 */
const LEGACY_BUTTON_PRESS_SOUND = "button-press";
const LEGACY_TIMER_CHIME_SOUND = "timer-chime";

/** The click every button-ish action starts on. */
export const DEFAULT_CLICK_SOUND = "medium-mechanical-click";
/** The chime `timerAlert` starts on, and what the retired timer sentinel becomes. */
export const DEFAULT_CHIME_SOUND = "chime-classic";

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

/** null = None. Any other string is a sound id or the reminder sentinel. */
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

// Everything defaults to a click, except the two that have a deliberate sound
// of their own: the timer alert chimes and the reminder alert plays the
// uploaded reminder MP3 (specs/ux-sounds.md, "Defaults").
export const DEFAULT_UX_SOUNDS: UxSoundAssignments = {
  unlockDial: DEFAULT_CLICK_SOUND,
  dialClick: DEFAULT_CLICK_SOUND,
  foldBreak: DEFAULT_CLICK_SOUND,
  foldHeal: DEFAULT_CLICK_SOUND,
  sectionChange: DEFAULT_CLICK_SOUND,
  buttonPress: DEFAULT_CLICK_SOUND,
  timerAlert: DEFAULT_CHIME_SOUND,
  reminderAlert: REMINDER_AUDIO_SOUND,
  reminderConfirm: DEFAULT_CLICK_SOUND,
  timerSet: DEFAULT_CLICK_SOUND,
  lightsOn: DEFAULT_CLICK_SOUND,
  lightsOff: DEFAULT_CLICK_SOUND,
};

const ACTION_SET = new Set<string>(UX_SOUND_ACTIONS);

export function isUxSoundAction(value: string): value is UxSoundAction {
  return ACTION_SET.has(value);
}

/** A retired sentinel mapped onto the library id that replaces it. */
export function migrateLegacySoundId(assigned: string): string {
  if (assigned === LEGACY_BUTTON_PRESS_SOUND) {
    return DEFAULT_CLICK_SOUND;
  }
  if (assigned === LEGACY_TIMER_CHIME_SOUND) {
    return DEFAULT_CHIME_SOUND;
  }
  return assigned;
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
      result[action] = migrateLegacySoundId(assigned.trim().slice(0, 60));
    }
  }
  return result;
}
