/**
 * Shapes the Phonoscope config panel reads from `/api/phonoscope/config`.
 * Split out of `PhonoscopeConfig.tsx` (specs/agent-token-footprint.md §4).
 */
import type {
  PhonoscopeColorGroup,
  PhonoscopeColorTheme,
  PhonoscopeHouseParty,
  PhonoscopeSettingsGroup,
} from "../../../../lib/types";
import type { PaletteSlot } from "../../phonoscope/ColorThemeLibrary";
import type { ModuleSetting } from "../../phonoscope/types";

export type ModuleSummary = {
  id: string;
  packageName: string;
  version: string;
  name: string;
  description: string;
  dimension: "2d" | "3d";
  hash: string;
  builtin: boolean;
  settings: ModuleSetting[];
  paletteSlots: PaletteSlot[];
  previewUrl?: string;
};

export type Config = {
  activeModuleId: string;
  activeModuleVersion: string;
  idleBehavior: "ambient" | "black" | "return";
  screensaverSeconds: number;
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
};

export type Payload = { config: Config; modules: ModuleSummary[]; error?: string };

export type { ModuleSetting };
