// Which sigil belongs to which reminder — facade. The body lives in
// lib/reminder-glyph/; this file keeps the import path stable for its callers
// (specs/agent-token-footprint.md §3.3).
//
// The pure (React-free) half of the reminder sigil system. The catalogue lives
// here rather than beside the Phosphor components because the server needs it
// too: `lib/reminder-icons.ts` runs the keyword matcher when a reminder is
// created, and the LLM classifier needs the id list as its allow-list.
// Importing the component registry there would drag React and ~70 icon
// modules into the Node runtime for no reason.
//
// `app/components/reminders/icon-registry.tsx` joins these ids to their
// Phosphor components.
//
// Where things are:
//
//   reminder-glyph/types.ts       ReminderGlyph, ReminderIconGroup, catalogue entry shape
//   reminder-glyph/constants.ts   fallback id/glyph, group labels, text-glyph length
//   reminder-glyph/catalogue.ts   REMINDER_ICON_CATALOG (single cohesive data table,
//                                 criterion §2.1) plus its id lookups
//   reminder-glyph/glyph-model.ts key normalisation, glyph validation, keyword matcher

export type { ReminderIconGroup, ReminderGlyph, ReminderIconCatalogEntry } from "./reminder-glyph/types";

export {
  FALLBACK_REMINDER_ICON_ID,
  REMINDER_GLYPH_TEXT_MAX_LENGTH,
  REMINDER_ICON_GROUP_LABELS,
  FALLBACK_REMINDER_GLYPH,
} from "./reminder-glyph/constants";

export {
  REMINDER_ICON_CATALOG,
  REMINDER_ICON_IDS,
  reminderIconCatalogEntry,
  isReminderIconId,
} from "./reminder-glyph/catalogue";

export {
  normalizeReminderKey,
  normalizeGlyph,
  glyphsEqual,
  matchReminderIconByKeyword,
} from "./reminder-glyph/glyph-model";
