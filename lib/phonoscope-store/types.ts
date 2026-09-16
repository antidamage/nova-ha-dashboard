import type { PhonoscopeModuleSummary } from "../phonoscope";
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorTheme,
  PhonoscopeHouseParty,
  PhonoscopeSettingsGroup,
} from "../types";

export type PhonoscopeConfig = {
  /**
   * Which migrations have already been applied to the stored shape. Read
   * bumps it to `PHONOSCOPE_SCHEMA_VERSION`; the next write persists it. See
   * `phonoscope-migrate-v4.ts` for why the percentage conversion cannot be
   * sniffed from the values themselves.
   */
  schemaVersion: number;
  activeModuleId: string;
  activeModuleVersion: string;
  idleBehavior: "ambient" | "black" | "return";
  /**
   * Seconds of silence before the screensaver: the picture fades to black and a
   * randomly chosen image bounces around the frame. 0 disables it.
   */
  screensaverSeconds: number;
  /**
   * The centre of the picture, when it is text.
   *
   * The image half comes from the live colour theme, never from here. A
   * non-blank message overrides whatever image the theme supplies; blank means
   * the theme's image shows, and a theme with no image means nothing is drawn.
   */
  message: string;
  statusOverlay: boolean;
  transitionMs: number;
  providers: {
    spotify: boolean;
    songle: boolean;
    essentia: boolean;
    reccoBeats: boolean;
    lrclib: boolean;
  };
  moduleSettings: Record<string, Record<string, number>>;
  pendingStructuralModuleSettings: Record<string, Record<string, number>>;
  moduleReloadGenerations: Record<string, number>;
  settingsGroups: PhonoscopeSettingsGroup[];
  colorThemes: PhonoscopeColorTheme[];
  colorGroups: PhonoscopeColorGroup[];
  moduleColorGroupIds: Record<string, string>;
  chooseColorGroupByGenre: boolean;
  structuralSettings: Record<string, number>;
  houseParty: PhonoscopeHouseParty;
  soloColorThemeId: string;
  soloSettingsGroupId: string;
  editorPreviewColorGroupId: string;
  editorPreviewColorEntryId: string;
  updatedAt?: string;
};


export type StoredManifest = PhonoscopeModuleSummary & {
  assets: string[];
  installedAt: string;
  warnings: string[];
};

