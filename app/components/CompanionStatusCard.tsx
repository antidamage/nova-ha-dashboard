"use client";

/*
 * Companion status card — facade. The body lives in companion/
 * (specs/agent-token-footprint.md §3.3).
 *
 *   companion/types.ts                 the /api/voice/companion-status payload
 *   companion/constants.ts             refresh interval, label and tone tables
 *   companion/status-model.ts          headline, age, per-arm timing, faster side
 *   companion/ComparisonSide.tsx       one side of a both-routes comparison
 *   companion/CompanionStatusCard.tsx  the card
 */
export { default } from "./companion/CompanionStatusCard";
