import { mkdir, writeFile } from "fs/promises";
import path from "path";
import {
  DEFAULT_CLICK_SOUND,
  UX_SOUND_ACTIONS,
} from "../app/components/dashboard/uxSoundActions";
import { mergeDashboardPreferences, readDashboardPreferences } from "./preferences";
import {
  normalizeSoundLibrary,
  normalizeSoundName,
  SOUND_FILE_MAX_BYTES,
  uniqueSoundId,
  type SoundLibraryEntry,
} from "./sound-library";
import { soundsDirectory, uploadedSoundPath } from "./sound-storage";

/**
 * One-time migration of the retired single control sound into the UX sound
 * library.
 *
 * Until 2026-09-16 a theme carried its own uploaded clip as a data URL in
 * `controlSound.source`, plus a `timerSound` chime name, and assignments
 * referred to them through the sentinels `"button-press"` and `"timer-chime"`.
 * Both fields are gone from the config page, so those sentinels no longer have
 * anything to resolve against.
 *
 * Rather than dropping a household's uploaded click on the floor, this imports
 * it into the library as an ordinary uploaded clip and repoints every
 * assignment that used the sentinel at it — so the dashboard keeps making the
 * sound it made yesterday, now visible in the list where it can be changed.
 *
 * Idempotent: once no theme carries a `source`, a `timerSound` or a legacy
 * sentinel, it makes no writes at all. See specs/ux-sounds.md.
 */

const LEGACY_BUTTON_PRESS = "button-press";
const LEGACY_TIMER_CHIME = "timer-chime";

/** The timer picker's names mapped onto the matching built-in chime clips. */
const TIMER_SOUND_CHIMES: Record<string, string> = {
  chime: "chime-classic",
  magical: "chime-magical",
  "motion tracker": "chime-motion-tracker",
  "retro boop": "chime-retro-boop",
  "soft boop": "chime-soft-boop",
  tink: "chime-tink",
};

type LegacyTheme = Record<string, unknown> & {
  controlSound?: { name?: unknown; source?: unknown; volume?: unknown } | null;
  timerSound?: unknown;
  uxSounds?: Record<string, unknown> | null;
};

/** Every object in the tree that looks like a theme carrying sound settings. */
function collectThemes(node: unknown, found: LegacyTheme[] = []): LegacyTheme[] {
  if (!node || typeof node !== "object") {
    return found;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      collectThemes(item, found);
    }
    return found;
  }
  const record = node as Record<string, unknown>;
  if ("controlSound" in record || "timerSound" in record) {
    found.push(record as LegacyTheme);
  }
  for (const value of Object.values(record)) {
    collectThemes(value, found);
  }
  return found;
}

function dataUrlBytes(source: unknown): Buffer | null {
  if (typeof source !== "string" || !source.startsWith("data:audio/")) {
    return null;
  }
  const base64 = source.slice(source.indexOf(",") + 1);
  try {
    const bytes = Buffer.from(base64, "base64");
    return bytes.byteLength > 0 && bytes.byteLength <= SOUND_FILE_MAX_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

function chimeIdFor(timerSound: unknown): string {
  const key = typeof timerSound === "string" ? timerSound.trim().toLowerCase() : "";
  return TIMER_SOUND_CHIMES[key] ?? TIMER_SOUND_CHIMES.chime;
}

export async function migrateControlSoundIntoLibrary(): Promise<void> {
  const preferences = await readDashboardPreferences();
  const themeRoots = [preferences.theme, preferences.themeLibrary];
  const themes = themeRoots.flatMap((root) => collectThemes(root));

  const needsWork = themes.some((theme) => (
    dataUrlBytes(theme.controlSound?.source) !== null
    || "timerSound" in theme
    || (theme.controlSound && ("source" in theme.controlSound || "name" in theme.controlSound))
    || UX_SOUND_ACTIONS.some((action) => {
      const assigned = theme.uxSounds?.[action];
      return assigned === LEGACY_BUTTON_PRESS || assigned === LEGACY_TIMER_CHIME;
    })
  ));
  if (!needsWork) {
    return;
  }

  const stored = normalizeSoundLibrary(preferences.soundLibrary);
  const taken = stored.entries.map((entry) => entry.id);
  const imported: SoundLibraryEntry[] = [];
  // One file per distinct clip, so the two built-in themes sharing an upload
  // do not import it twice.
  const idsByDataUrl = new Map<string, string>();

  for (const theme of themes) {
    const source = theme.controlSound?.source;
    const bytes = dataUrlBytes(source);
    if (!bytes || typeof source !== "string" || idsByDataUrl.has(source)) {
      continue;
    }
    const name = normalizeSoundName(
      typeof theme.controlSound?.name === "string"
        ? theme.controlSound.name.replace(/\.[^.]+$/, "")
        : null,
      "Control sound",
    );
    const id = uniqueSoundId(name, taken);
    taken.push(id);
    await mkdir(soundsDirectory(), { recursive: true });
    await writeFile(uploadedSoundPath(id), bytes);
    imported.push({
      id,
      name,
      origin: "upload",
      bytes: bytes.byteLength,
      updatedAt: new Date().toISOString(),
    });
    idsByDataUrl.set(source, id);
  }

  for (const theme of themes) {
    const source = typeof theme.controlSound?.source === "string" ? theme.controlSound.source : null;
    // Whatever this theme's "button press" used to mean: its own imported clip
    // if it had one, otherwise the default click.
    const buttonPressId = (source && idsByDataUrl.get(source)) || DEFAULT_CLICK_SOUND;
    const chimeId = chimeIdFor(theme.timerSound);

    const assignments = theme.uxSounds;
    if (assignments && typeof assignments === "object") {
      for (const action of UX_SOUND_ACTIONS) {
        if (assignments[action] === LEGACY_BUTTON_PRESS) {
          assignments[action] = buttonPressId;
        } else if (assignments[action] === LEGACY_TIMER_CHIME) {
          assignments[action] = chimeId;
        }
      }
    }

    theme.controlSound = { volume: theme.controlSound?.volume ?? 60 };
    delete theme.timerSound;
  }

  await mergeDashboardPreferences({
    theme: preferences.theme,
    themeLibrary: preferences.themeLibrary,
    soundLibrary: normalizeSoundLibrary({
      entries: [...stored.entries, ...imported],
    }) as unknown as Record<string, unknown>,
  } as Parameters<typeof mergeDashboardPreferences>[0]);

  if (imported.length > 0) {
    console.log(
      `[ux-sounds] imported ${imported.length} control sound(s) into the library:`,
      imported.map((entry) => `${entry.id} (${path.basename(uploadedSoundPath(entry.id))})`).join(", "),
    );
  }
}
