"use client";

// Facade: ConfigWorkspace imports this lazily, so it re-exports the component
// only. The body lives in ./config/reminders/.
export { RemindersConfig } from "./config/reminders/RemindersConfig";
