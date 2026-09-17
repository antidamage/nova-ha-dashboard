export type ReminderIconGroup = "health" | "hygiene" | "home" | "money" | "life";

export type ReminderGlyph =
  | { kind: "phosphor"; id: string }
  /** 1-2 characters, e.g. "E" for estrogen. Phosphor has no letterforms. */
  | { kind: "text"; value: string };

export type ReminderIconCatalogEntry = {
  id: string;
  label: string;
  group: ReminderIconGroup;
  /**
   * Lower-case substrings that identify this icon from a reminder's name with
   * no LLM round trip. The matcher prefers the LONGEST hit, so "wash hair"
   * beats "washing" for "Wash hair tonight".
   */
  keywords: string[];
};
