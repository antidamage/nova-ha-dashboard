"use client";

import { ArrowRight, Repeat, Shuffle } from "lucide-react";
import type { PhonoscopePlaybackOrder } from "../../../lib/phonoscope-drivers";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";

/**
 * How the colour-theme playlist plays, as three mutually exclusive icons.
 *
 * A real radio group rather than three toggles: exactly one is always on, and
 * `role="radiogroup"` plus `aria-checked` is what tells a screen reader that
 * choosing one clears the others. Icons because the three modes are the same
 * three every media transport has, and their glyphs are more legible at a
 * glance than the words were in the dropdown this replaced.
 */
const PLAYBACK_ORDERS: {
  value: PhonoscopePlaybackOrder;
  label: string;
  detail: string;
  icon: typeof Repeat;
}[] = [
  { value: "once", label: "Play once", detail: "Run through the playlist and hold on the last theme.", icon: ArrowRight },
  { value: "loop", label: "Loop", detail: "Run through the playlist and start again.", icon: Repeat },
  { value: "shuffle", label: "Shuffle", detail: "Pick a different theme at random each time.", icon: Shuffle },
];

/** Split out of `EffectEntry.tsx` (specs/agent-token-footprint.md §4). */
export function PlaybackOrderControl({
  onChange,
  value,
}: {
  onChange: (order: PhonoscopePlaybackOrder) => void;
  value: PhonoscopePlaybackOrder;
}) {
  return (
    <div className="grid gap-1">
      <span className="text-xs font-black uppercase text-neutral-400">Playback</span>
      <div role="radiogroup" aria-label="Playback" className="flex items-center gap-2">
        {PLAYBACK_ORDERS.map((order) => {
          const Icon = order.icon;
          const active = value === order.value;
          return (
            <MomentaryFeedbackButton
              key={order.value}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={order.label}
              title={`${order.label} — ${order.detail}`}
              className={`flex items-center gap-2 rounded border px-3 py-2 text-xs ${
                active
                  ? "border-cyan-400 text-cyan-200"
                  : "border-neutral-800 text-neutral-500"
              }`}
              onClick={() => onChange(order.value)}
            >
              <Icon className="h-4 w-4" />
              <span>{order.label}</span>
            </MomentaryFeedbackButton>
          );
        })}
      </div>
    </div>
  );
}
