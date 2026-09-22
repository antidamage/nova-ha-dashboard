"use client";

/**
 * Component half of the preset icon catalogue: joins each id from
 * `lib/apple-tv/preset-icons.ts` to its Lucide component.
 *
 * The ids and their labels live in the lib half so the API route can validate a
 * stored choice without pulling React, or these icons, into the Node runtime —
 * the same split, for the same reason, as the reminder sigil registry.
 *
 * These are Lucide rather than the reminder pickers' Phosphor set: the preset
 * buttons are Lucide buttons and always have been, so a chosen icon and the
 * note it replaces are drawn by the same family and cannot read as two
 * different kinds of mark.
 */
import {
  AudioLines,
  CloudRain,
  Coffee,
  Crown,
  Disc3,
  Drum,
  Dumbbell,
  Flame,
  Ghost,
  Guitar,
  Headphones,
  Heart,
  ListMusic,
  Martini,
  Mic,
  Moon,
  Music,
  PartyPopper,
  Popcorn,
  Radio,
  Skull,
  Sparkles,
  Speaker,
  Star,
  Sun,
  Waves,
  Zap,
  type LucideIcon,
} from "lucide-react";
import { DEFAULT_PRESET_ICON_ID, PRESET_ICON_CATALOG } from "../../../lib/apple-tv/preset-icons";

const ICON_COMPONENTS: Record<string, LucideIcon> = {
  [DEFAULT_PRESET_ICON_ID]: Music,
  "audio-lines": AudioLines,
  "cloud-rain": CloudRain,
  coffee: Coffee,
  crown: Crown,
  disc3: Disc3,
  drum: Drum,
  dumbbell: Dumbbell,
  flame: Flame,
  ghost: Ghost,
  guitar: Guitar,
  headphones: Headphones,
  heart: Heart,
  "list-music": ListMusic,
  martini: Martini,
  mic: Mic,
  moon: Moon,
  "party-popper": PartyPopper,
  popcorn: Popcorn,
  radio: Radio,
  skull: Skull,
  sparkles: Sparkles,
  speaker: Speaker,
  star: Star,
  sun: Sun,
  waves: Waves,
  zap: Zap,
};

// Tripwire: a catalogue entry with no component would render an empty button.
// Cheap to check, and it turns a silent visual hole into an obvious dev error.
if (process.env.NODE_ENV !== "production") {
  const missing = PRESET_ICON_CATALOG.filter((entry) => !ICON_COMPONENTS[entry.id]);
  if (missing.length > 0) {
    console.error("[apple-tv] preset icon ids with no component:", missing.map((entry) => entry.id).join(", "));
  }
}

/**
 * The component for a preset's icon. A preset with no choice, an id a later
 * build stopped shipping and a corrupt one all draw the note, so a button is
 * never blank.
 */
export function presetIconComponent(icon: string | null): LucideIcon {
  return (icon ? ICON_COMPONENTS[icon] : undefined) ?? ICON_COMPONENTS[DEFAULT_PRESET_ICON_ID];
}

/** A preset's icon, sized by whatever the caller's class says. */
export function PresetIconMark({ className, icon }: { className?: string; icon: string | null }) {
  const Mark = presetIconComponent(icon);
  return <Mark aria-hidden="true" className={className} />;
}
