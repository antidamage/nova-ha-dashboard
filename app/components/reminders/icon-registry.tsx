"use client";

// Component half of the reminder sigil system: joins each catalogue id from
// lib/reminder-glyph.ts to its Phosphor component.
//
// Why a curated list and not the whole package: @phosphor-icons/react ships
// ~1500 icons x 6 weights. Every icon is imported from its own `dist/csr/<Name>`
// entry point so only the icons named here reach the bundle.
//
// Weight is "bold" everywhere: the brief was block art / thick lines that read
// at a glance from across a room, and bold is the heaviest outline weight
// before Phosphor switches to solid fills.

import type { Icon as PhosphorIcon } from "@phosphor-icons/react";
import { AirplaneIcon } from "@phosphor-icons/react/dist/csr/Airplane";
import { AlarmIcon } from "@phosphor-icons/react/dist/csr/Alarm";
import { BabyIcon } from "@phosphor-icons/react/dist/csr/Baby";
import { BandaidsIcon } from "@phosphor-icons/react/dist/csr/Bandaids";
import { BankIcon } from "@phosphor-icons/react/dist/csr/Bank";
import { BarbellIcon } from "@phosphor-icons/react/dist/csr/Barbell";
import { BasketIcon } from "@phosphor-icons/react/dist/csr/Basket";
import { BathtubIcon } from "@phosphor-icons/react/dist/csr/Bathtub";
import { BedIcon } from "@phosphor-icons/react/dist/csr/Bed";
import { BellIcon } from "@phosphor-icons/react/dist/csr/Bell";
import { BookOpenIcon } from "@phosphor-icons/react/dist/csr/BookOpen";
import { BrainIcon } from "@phosphor-icons/react/dist/csr/Brain";
import { BriefcaseIcon } from "@phosphor-icons/react/dist/csr/Briefcase";
import { BroomIcon } from "@phosphor-icons/react/dist/csr/Broom";
import { CakeIcon } from "@phosphor-icons/react/dist/csr/Cake";
import { CalendarCheckIcon } from "@phosphor-icons/react/dist/csr/CalendarCheck";
import { CarIcon } from "@phosphor-icons/react/dist/csr/Car";
import { CatIcon } from "@phosphor-icons/react/dist/csr/Cat";
import { CoffeeIcon } from "@phosphor-icons/react/dist/csr/Coffee";
import { CreditCardIcon } from "@phosphor-icons/react/dist/csr/CreditCard";
import { CurrencyDollarIcon } from "@phosphor-icons/react/dist/csr/CurrencyDollar";
import { DogIcon } from "@phosphor-icons/react/dist/csr/Dog";
import { DropIcon } from "@phosphor-icons/react/dist/csr/Drop";
import { EnvelopeIcon } from "@phosphor-icons/react/dist/csr/Envelope";
import { EyeIcon } from "@phosphor-icons/react/dist/csr/Eye";
import { FireIcon } from "@phosphor-icons/react/dist/csr/Fire";
import { FirstAidIcon } from "@phosphor-icons/react/dist/csr/FirstAid";
import { FlowerIcon } from "@phosphor-icons/react/dist/csr/Flower";
import { ForkKnifeIcon } from "@phosphor-icons/react/dist/csr/ForkKnife";
import { GasCanIcon } from "@phosphor-icons/react/dist/csr/GasCan";
import { GiftIcon } from "@phosphor-icons/react/dist/csr/Gift";
import { GraduationCapIcon } from "@phosphor-icons/react/dist/csr/GraduationCap";
import { HammerIcon } from "@phosphor-icons/react/dist/csr/Hammer";
import { HandSoapIcon } from "@phosphor-icons/react/dist/csr/HandSoap";
import { HeartIcon } from "@phosphor-icons/react/dist/csr/Heart";
import { HeartbeatIcon } from "@phosphor-icons/react/dist/csr/Heartbeat";
import { HouseIcon } from "@phosphor-icons/react/dist/csr/House";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { LeafIcon } from "@phosphor-icons/react/dist/csr/Leaf";
import { LightningIcon } from "@phosphor-icons/react/dist/csr/Lightning";
import { ListChecksIcon } from "@phosphor-icons/react/dist/csr/ListChecks";
import { MoneyIcon } from "@phosphor-icons/react/dist/csr/Money";
import { MoonIcon } from "@phosphor-icons/react/dist/csr/Moon";
import { NotePencilIcon } from "@phosphor-icons/react/dist/csr/NotePencil";
import { PackageIcon } from "@phosphor-icons/react/dist/csr/Package";
import { PawPrintIcon } from "@phosphor-icons/react/dist/csr/PawPrint";
import { PhoneIcon } from "@phosphor-icons/react/dist/csr/Phone";
import { PiggyBankIcon } from "@phosphor-icons/react/dist/csr/PiggyBank";
import { PillIcon } from "@phosphor-icons/react/dist/csr/Pill";
import { PlantIcon } from "@phosphor-icons/react/dist/csr/Plant";
import { PulseIcon } from "@phosphor-icons/react/dist/csr/Pulse";
import { ReceiptIcon } from "@phosphor-icons/react/dist/csr/Receipt";
import { RecycleIcon } from "@phosphor-icons/react/dist/csr/Recycle";
import { ScissorsIcon } from "@phosphor-icons/react/dist/csr/Scissors";
import { ShoppingCartIcon } from "@phosphor-icons/react/dist/csr/ShoppingCart";
import { ShowerIcon } from "@phosphor-icons/react/dist/csr/Shower";
import { SnowflakeIcon } from "@phosphor-icons/react/dist/csr/Snowflake";
import { SparkleIcon } from "@phosphor-icons/react/dist/csr/Sparkle";
import { SunIcon } from "@phosphor-icons/react/dist/csr/Sun";
import { SyringeIcon } from "@phosphor-icons/react/dist/csr/Syringe";
import { TShirtIcon } from "@phosphor-icons/react/dist/csr/TShirt";
import { ToiletIcon } from "@phosphor-icons/react/dist/csr/Toilet";
import { ToothIcon } from "@phosphor-icons/react/dist/csr/Tooth";
import { TowelIcon } from "@phosphor-icons/react/dist/csr/Towel";
import { TrashIcon } from "@phosphor-icons/react/dist/csr/Trash";
import { WashingMachineIcon } from "@phosphor-icons/react/dist/csr/WashingMachine";
import { WrenchIcon } from "@phosphor-icons/react/dist/csr/Wrench";

import {
  FALLBACK_REMINDER_ICON_ID,
  REMINDER_ICON_CATALOG,
  reminderIconCatalogEntry,
  type ReminderGlyph,
} from "../../../lib/reminder-glyph";

const ICON_COMPONENTS: Record<string, PhosphorIcon> = {
  airplane: AirplaneIcon,
  alarm: AlarmIcon,
  baby: BabyIcon,
  bandaids: BandaidsIcon,
  bank: BankIcon,
  barbell: BarbellIcon,
  basket: BasketIcon,
  bathtub: BathtubIcon,
  bed: BedIcon,
  bell: BellIcon,
  "book-open": BookOpenIcon,
  brain: BrainIcon,
  briefcase: BriefcaseIcon,
  broom: BroomIcon,
  cake: CakeIcon,
  "calendar-check": CalendarCheckIcon,
  car: CarIcon,
  cat: CatIcon,
  coffee: CoffeeIcon,
  "credit-card": CreditCardIcon,
  "currency-dollar": CurrencyDollarIcon,
  dog: DogIcon,
  drop: DropIcon,
  envelope: EnvelopeIcon,
  eye: EyeIcon,
  fire: FireIcon,
  "first-aid": FirstAidIcon,
  flower: FlowerIcon,
  "fork-knife": ForkKnifeIcon,
  "gas-can": GasCanIcon,
  gift: GiftIcon,
  "graduation-cap": GraduationCapIcon,
  hammer: HammerIcon,
  "hand-soap": HandSoapIcon,
  heart: HeartIcon,
  heartbeat: HeartbeatIcon,
  house: HouseIcon,
  key: KeyIcon,
  leaf: LeafIcon,
  lightning: LightningIcon,
  "list-checks": ListChecksIcon,
  money: MoneyIcon,
  moon: MoonIcon,
  "note-pencil": NotePencilIcon,
  package: PackageIcon,
  "paw-print": PawPrintIcon,
  phone: PhoneIcon,
  "piggy-bank": PiggyBankIcon,
  pill: PillIcon,
  plant: PlantIcon,
  pulse: PulseIcon,
  receipt: ReceiptIcon,
  recycle: RecycleIcon,
  scissors: ScissorsIcon,
  "shopping-cart": ShoppingCartIcon,
  shower: ShowerIcon,
  snowflake: SnowflakeIcon,
  sparkle: SparkleIcon,
  sun: SunIcon,
  syringe: SyringeIcon,
  tshirt: TShirtIcon,
  toilet: ToiletIcon,
  tooth: ToothIcon,
  towel: TowelIcon,
  trash: TrashIcon,
  "washing-machine": WashingMachineIcon,
  wrench: WrenchIcon,
};

// Tripwire: a catalogue entry with no component would render an empty tile.
// Cheap to check, and it turns a silent visual hole into an obvious dev error.
if (process.env.NODE_ENV !== "production") {
  const missing = REMINDER_ICON_CATALOG.filter((entry) => !ICON_COMPONENTS[entry.id]);
  if (missing.length > 0) {
    console.error(
      "[reminders] catalogue entries with no Phosphor component:",
      missing.map((entry) => entry.id).join(", "),
    );
  }
}

export function reminderIconComponent(id: string): PhosphorIcon | undefined {
  return ICON_COMPONENTS[id];
}

export function reminderGlyphLabel(glyph: ReminderGlyph) {
  if (glyph.kind === "text") {
    return glyph.value;
  }
  return reminderIconCatalogEntry(glyph.id)?.label ?? glyph.id;
}

/**
 * Render a glyph at the current font size. Phosphor sizes off `1em`, and text
 * glyphs use the display face so a letter sigil ("E") reads as a deliberate
 * mark rather than as leaked UI text.
 */
export function ReminderGlyphMark({ glyph }: { glyph: ReminderGlyph }) {
  if (glyph.kind === "text") {
    return (
      <span className="reminder-glyph-text" aria-hidden="true">
        {glyph.value}
      </span>
    );
  }

  const Mark =
    reminderIconComponent(glyph.id) ?? reminderIconComponent(FALLBACK_REMINDER_ICON_ID);

  if (!Mark) {
    return null;
  }

  return <Mark aria-hidden="true" className="reminder-glyph-mark" weight="bold" />;
}
