// Which sigil belongs to which reminder, and which reminders earn a tile in
// the icon bar.
//
// `app/components/reminders/icon-registry.tsx` joins these ids to their
// Phosphor components.

import type { ReminderIconCatalogEntry } from "./types";

export const REMINDER_ICON_CATALOG: ReminderIconCatalogEntry[] = [
  { id: "timer", label: "Timer", group: "life", keywords: ["countdown", "timer"] },
  { id: "umbrella", label: "Umbrella", group: "life", keywords: ["rain", "umbrella"] },
  { id: "spinner", label: "Updating", group: "life", keywords: ["update"] },

  // --- health -------------------------------------------------------------
  { id: "pill", label: "Pill", group: "health", keywords: ["pill", "meds", "medication", "medicine", "tablet", "estrogen", "oestrogen", "hrt", "hormone", "vitamin", "supplement"] },
  { id: "syringe", label: "Syringe", group: "health", keywords: ["injection", "inject", "syringe", "jab", "vaccine", "booster", "insulin"] },
  { id: "first-aid", label: "First aid", group: "health", keywords: ["doctor", "clinic", "medical", "prescription", "pharmacy", "chemist", "repeat script"] },
  { id: "bandaids", label: "Bandage", group: "health", keywords: ["dressing", "bandage", "wound", "plaster"] },
  { id: "heartbeat", label: "Heartbeat", group: "health", keywords: ["blood pressure", "heart rate", "checkup", "check-up"] },
  { id: "pulse", label: "Pulse", group: "health", keywords: ["vitals", "observation", "measure"] },
  { id: "tooth", label: "Tooth", group: "health", keywords: ["teeth", "tooth", "dentist", "floss", "brush teeth", "dental"] },
  { id: "eye", label: "Eye", group: "health", keywords: ["eye", "optometrist", "glasses", "contacts", "lenses"] },
  { id: "brain", label: "Brain", group: "health", keywords: ["therapy", "therapist", "counselling", "psych", "mental health"] },
  { id: "barbell", label: "Barbell", group: "health", keywords: ["gym", "workout", "exercise", "training", "weights"] },
  { id: "heart", label: "Heart", group: "health", keywords: ["self care", "selfcare"] },

  // --- hygiene ------------------------------------------------------------
  { id: "shower", label: "Shower", group: "hygiene", keywords: ["wash hair", "hair wash", "washing hair", "shampoo", "shower", "hair"] },
  { id: "bathtub", label: "Bath", group: "hygiene", keywords: ["bath", "soak", "bathe"] },
  { id: "hand-soap", label: "Soap", group: "hygiene", keywords: ["soap", "sanitiser", "sanitizer"] },
  { id: "towel", label: "Towel", group: "hygiene", keywords: ["towel", "linen", "change towels"] },
  { id: "scissors", label: "Scissors", group: "hygiene", keywords: ["haircut", "nails", "shave", "barber", "salon"] },
  { id: "toilet", label: "Toilet", group: "hygiene", keywords: ["toilet", "bathroom clean", "loo"] },
  { id: "sparkle", label: "Sparkle", group: "hygiene", keywords: ["tidy", "clean", "cleaning", "polish", "declutter"] },

  // --- home ---------------------------------------------------------------
  { id: "washing-machine", label: "Washing machine", group: "home", keywords: ["load of washing", "hang washing", "wash clothes", "washing", "laundry", "washer"] },
  { id: "tshirt", label: "Clothes", group: "home", keywords: ["clothes", "fold", "ironing", "iron", "dry clothes"] },
  { id: "broom", label: "Broom", group: "home", keywords: ["sweep", "vacuum", "mop", "floors", "hoover"] },
  { id: "trash", label: "Rubbish", group: "home", keywords: ["rubbish", "bins", "bin out", "trash", "garbage", "wheelie"] },
  { id: "recycle", label: "Recycling", group: "home", keywords: ["recycling", "recycle", "glass out", "yellow bin"] },
  { id: "bed", label: "Bed", group: "home", keywords: ["sheets", "bedding", "change bed", "make bed"] },
  { id: "plant", label: "Plant", group: "home", keywords: ["water plants", "plants", "garden", "watering"] },
  { id: "flower", label: "Flower", group: "home", keywords: ["flowers", "weeding", "prune"] },
  { id: "leaf", label: "Leaf", group: "home", keywords: ["lawn", "mow", "compost", "leaves", "hedge"] },
  { id: "wrench", label: "Wrench", group: "home", keywords: ["service", "servicing", "maintenance", "repair"] },
  { id: "hammer", label: "Hammer", group: "home", keywords: ["diy", "assemble"] },
  { id: "fire", label: "Fire", group: "home", keywords: ["heater", "heating", "firewood", "smoke alarm"] },
  { id: "snowflake", label: "Snowflake", group: "home", keywords: ["freezer", "defrost", "fridge", "aircon", "air con"] },
  { id: "lightning", label: "Lightning", group: "home", keywords: ["electricity", "meter read", "charge", "battery"] },
  { id: "drop", label: "Water", group: "home", keywords: ["water filter", "hydrate", "drink water"] },
  { id: "house", label: "House", group: "home", keywords: ["landlord", "inspection", "house"] },
  { id: "key", label: "Key", group: "home", keywords: ["keys", "lock up", "security"] },

  // --- money --------------------------------------------------------------
  { id: "currency-dollar", label: "Dollar", group: "money", keywords: ["rent", "bills", "bill", "pay ", "payment", "invoice", "money"] },
  { id: "receipt", label: "Receipt", group: "money", keywords: ["receipt", "expenses", "tax", "ird", "gst", "accounts"] },
  { id: "credit-card", label: "Card", group: "money", keywords: ["subscription", "direct debit", "renew card"] },
  { id: "bank", label: "Bank", group: "money", keywords: ["bank", "mortgage", "loan", "transfer"] },
  { id: "piggy-bank", label: "Savings", group: "money", keywords: ["savings", "budget", "kiwisaver"] },
  { id: "money", label: "Cash", group: "money", keywords: ["cash", "wages", "payday", "income"] },
  { id: "shopping-cart", label: "Shopping", group: "money", keywords: ["shopping", "groceries", "supermarket"] },
  { id: "basket", label: "Basket", group: "money", keywords: ["click and collect", "order"] },

  // --- life ---------------------------------------------------------------
  { id: "bell", label: "Bell", group: "life", keywords: ["reminder", "remind"] },
  { id: "alarm", label: "Alarm", group: "life", keywords: ["alarm", "wake up", "timer"] },
  { id: "calendar-check", label: "Calendar", group: "life", keywords: ["appointment", "booking", "meeting", "calendar", "schedule"] },
  { id: "envelope", label: "Post", group: "life", keywords: ["email", "post", "mail", "letter", "reply"] },
  { id: "phone", label: "Phone", group: "life", keywords: ["call ", "ring ", "phone", "voicemail"] },
  { id: "package", label: "Parcel", group: "life", keywords: ["parcel", "delivery", "courier", "package", "pickup"] },
  { id: "car", label: "Car", group: "life", keywords: ["wof", "rego", "registration", "tyres", "warrant", "car"] },
  { id: "gas-can", label: "Fuel", group: "life", keywords: ["fuel", "petrol", "diesel"] },
  { id: "airplane", label: "Travel", group: "life", keywords: ["flight", "travel", "passport", "airport"] },
  { id: "dog", label: "Dog", group: "life", keywords: ["walk the dog", "dog", "vet"] },
  { id: "cat", label: "Cat", group: "life", keywords: ["litter", "cat"] },
  { id: "paw-print", label: "Pet", group: "life", keywords: ["pet", "flea", "worming"] },
  { id: "fork-knife", label: "Meal", group: "life", keywords: ["dinner", "lunch", "breakfast", "meal", "cook"] },
  { id: "coffee", label: "Coffee", group: "life", keywords: ["coffee", "tea", "brew"] },
  { id: "cake", label: "Birthday", group: "life", keywords: ["birthday", "anniversary"] },
  { id: "gift", label: "Gift", group: "life", keywords: ["gift", "present", "christmas"] },
  { id: "baby", label: "Baby", group: "life", keywords: ["baby", "nappy", "creche"] },
  { id: "book-open", label: "Reading", group: "life", keywords: ["read ", "book", "library"] },
  { id: "graduation-cap", label: "Study", group: "life", keywords: ["course", "assignment", "exam", "lecture", "study"] },
  { id: "briefcase", label: "Work", group: "life", keywords: ["timesheet", "standup", "shift", "work"] },
  { id: "note-pencil", label: "Note", group: "life", keywords: ["journal", "draft", "write"] },
  { id: "list-checks", label: "Checklist", group: "life", keywords: ["checklist", "chores", "todo"] },
  { id: "sun", label: "Morning", group: "life", keywords: ["morning", "sunrise"] },
  { id: "moon", label: "Night", group: "life", keywords: ["bedtime", "evening", "night"] },
];

const CATALOG_BY_ID = new Map(REMINDER_ICON_CATALOG.map((entry) => [entry.id, entry]));

/** The allow-list handed to the LLM classifier and used to validate its answer. */
export const REMINDER_ICON_IDS = REMINDER_ICON_CATALOG.map((entry) => entry.id);

export function reminderIconCatalogEntry(id: string) {
  return CATALOG_BY_ID.get(id);
}

export function isReminderIconId(value: unknown): value is string {
  return typeof value === "string" && CATALOG_BY_ID.has(value);
}
