"use client";

// Facade: the reminder sigil bar between the clock and the zones panel. The
// body, including its lite-mode note, lives in ./reminders/:
//   types.ts           roster entry and tile shapes
//   tile-model.ts      tile ordering and roster parsing
//   ReminderIconBar.tsx the bar component
export { compareReminderTiles } from "./reminders/tile-model";
export { ReminderIconBar } from "./reminders/ReminderIconBar";
