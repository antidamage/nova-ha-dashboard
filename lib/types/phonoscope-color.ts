export type PhonoscopeColorValue = {
  rgb: [number, number, number];
  intensity: number;
  opacity: number;
  cursor?: { x: number; y: number };
};

/**
 * Colour, and the picture's centrepiece. Behaviour lives in settings groups,
 * which a colour group entry names alongside the theme, so the same palette can
 * run under several different sets of drivers.
 */
export type PhonoscopeColorTheme = {
  id: string;
  name: string;
  /** Palette slots are declared per module, so a theme belongs to one visualiser. */
  moduleId: string;
  colors: Record<string, PhonoscopeColorValue>;
  /**
   * A centre-image library id this theme puts in the middle of the frame, or
   * null for none. The rotation cross-fades between entries' images over the
   * same transition their palettes chase across.
   */
  imageId: string | null;
  /**
   * A library id this theme puts BEHIND the whole picture, or null for none.
   *
   * When set it replaces the procedural backdrop field entirely; when null the
   * field runs as it always has. Either way the same `__bg*` effects size it,
   * so the controls do not change when the content does. It is drawn inside the
   * backdrop pass, which puts it under the vignette — the frame closes over the
   * image exactly as it closes over the field.
   */
  backgroundImageId: string | null;
};

/**
 * One stop on a colour group's rotation. A theme may appear in several entries
 * with different settings groups — "theme 1 with settings A", then "theme 1 with
 * settings B", then "theme 2 with settings B" — which is why entries carry their
 * own id rather than being keyed by `themeId`.
 */
export type PhonoscopeColorGroupEntry = {
  id: string;
  themeId: string;
  /**
   * A second colour theme this entry blends to while the household's alt state
   * is on. It is a link into the same flat library rather than a theme of its
   * own, so editing that theme edits both places it is used.
   *
   * Null or absent means this entry has no alternative and simply keeps showing
   * `themeId` — the alt state stays on, it just has nothing to do here.
   */
  altThemeId?: string | null;
  /**
   * Applied in order. Their lanes all run at once; a colliding `combine` mode or
   * static setting layers, with the last group in this list winning.
   */
  settingsGroupIds: string[];
};

export type PhonoscopeColorGroup = {
  id: string;
  /** Colour groups are owned by one visualiser and never shared across modules. */
  moduleId: string;
  name: string;
  /** The rotation playlist, in order. */
  entries: PhonoscopeColorGroupEntry[];
  /** Exclusive across groups: assigning a genre here takes it from whoever held it. */
  genres: string[];
  /** Exactly one group carries this; it catches tracks with no or an unclaimed genre. */
  isDefault: boolean;
};
