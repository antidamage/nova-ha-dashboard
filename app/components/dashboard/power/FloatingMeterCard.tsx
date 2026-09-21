"use client";

import { AudioLines, Check, CookingPot, Monitor, Plug, Tv, WashingMachine } from "lucide-react";
import type { ComponentType } from "react";
import { useEffect, useMemo, useState } from "react";
import type { AmpSwitches, PowerFloatingMeterSummary } from "../../../../lib/power";
import type { FloatingMeterCategoryReading } from "../../../../lib/power/floating-meter";
import { ConfigSelect } from "../../ConfigSelect";
import { ConfirmDialog } from "../../ConfirmDialog";
import { classNames } from "../shared";
import { formatWatts } from "./meters-model";

const CATEGORY_ICONS: Record<FloatingMeterCategoryReading["icon"], ComponentType<{ className?: string }>> = {
  amp: AudioLines,
  computers: Monitor,
  entertainment: Tv,
  kitchen: CookingPot,
  laundry: WashingMachine,
  other: Plug,
};

/** How much a category's number is worth, at a glance. */
const CONFIDENCE_LABEL: Record<FloatingMeterCategoryReading["confidence"], string> = {
  measured: "measured",
  high: "learned",
  medium: "learned avg",
  assumed: "estimated",
};

export function FloatingMeterCard({ summary }: { summary: PowerFloatingMeterSummary }) {
  const [pending, setPending] = useState<string | null>(null);
  /** The category a tap has chosen but not yet confirmed (specs/amp-appletv-power.md §6). */
  const [proposed, setProposed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** The amp's two switches, optimistic until the server reports them back (§7). */
  const [automation, setAutomation] = useState<AmpSwitches | null>(null);

  const ampControl = summary.ampControl;
  const switches: AmpSwitches = automation ?? {
    autoOff: ampControl?.autoOff ?? true,
    autoOn: ampControl?.autoOn ?? true,
  };

  // Drop the optimistic choice as soon as the server reports it, so a failed
  // move falls back to the truth rather than sticking on screen.
  useEffect(() => {
    if (pending && summary.activeCategoryId === pending) {
      setPending(null);
    }
  }, [pending, summary.activeCategoryId]);

  // Same for the switches: the panel's own poll is the truth, and the override
  // clears only once the server agrees on both of them.
  useEffect(() => {
    if (
      automation &&
      ampControl?.autoOff === automation.autoOff &&
      ampControl?.autoOn === automation.autoOn
    ) {
      setAutomation(null);
    }
  }, [automation, ampControl]);

  const setAutomationSwitches = async (next: AmpSwitches) => {
    setAutomation(next);
    try {
      const response = await fetch("/api/power/amp-automation", {
        body: JSON.stringify(next),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      if (!response.ok) {
        setAutomation(null);
      }
    } catch {
      setAutomation(null);
    }
  };

  const activeId = pending ?? summary.activeCategoryId ?? summary.categories[0]?.id ?? "";

  const options = useMemo(
    () =>
      summary.categories.map((category) => {
        const Icon = CATEGORY_ICONS[category.icon] ?? Plug;
        return {
          value: category.id,
          label: category.label,
          detail: category.members.join(", ") || undefined,
          icon: <Icon className="h-4 w-4" />,
        };
      }),
    [summary.categories],
  );

  const labelOf = (categoryId: string | null) =>
    summary.categories.find((category) => category.id === categoryId)?.label ?? "nothing";

  // The category is server state describing where a physical plug is, not a
  // preference: a mis-tap teaches the model one group's draw against another
  // group's name, and a mis-tap onto the amp hands the Apple TV authority over
  // a plug feeding something else. So nothing is sent until it is confirmed.
  const propose = (categoryId: string) => {
    if (categoryId !== activeId) {
      setProposed(categoryId);
    }
  };

  const move = async () => {
    const categoryId = proposed;
    if (!categoryId) {
      return;
    }
    setBusy(true);
    try {
      await fetch("/api/power/floating-meter", {
        body: JSON.stringify({ categoryId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      });
      setPending(categoryId);
    } catch {
      setPending(null);
    } finally {
      setBusy(false);
      setProposed(null);
    }
  };

  const confirmCopy = proposed
    ? {
        stages: [
          {
            title: "Move the floating meter?",
            body: `The meter is measuring ${labelOf(activeId)}. Moving it to ${labelOf(proposed)} folds what it has learned into ${labelOf(activeId)} and starts measuring ${labelOf(proposed)}. Only move it if you have physically moved the plug.`,
            confirmLabel: "Move the meter",
          },
        ],
        cancelLabel: "Cancel",
      }
    : null;

  return (
    <section className="power-meter-card border border-neutral-700 bg-neutral-950/70 p-4">
      <header className="mb-3 flex items-baseline justify-between gap-3">
        <p className="text-sm font-black uppercase text-cyan-200">Floating Meter</p>
        <p className="text-sm font-black tabular-nums text-neutral-100">{formatWatts(summary.watts)}</p>
      </header>

      <ConfigSelect
        ariaLabel="What the floating meter is measuring"
        onChange={propose}
        options={options}
        value={activeId}
      />

      <div className="power-meter-rows mt-3 grid gap-1">
        {summary.categories.map((category) => {
          const Icon = CATEGORY_ICONS[category.icon] ?? Plug;
          const live = category.id === activeId;
          return (
            <div
              key={category.id}
              className={classNames(
                "power-meter-row grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 border border-neutral-800 bg-neutral-900/60 px-2 py-1.5",
                live && "is-live border-cyan-300/40",
              )}
            >
              <Icon className={classNames("h-4 w-4 shrink-0", live ? "text-cyan-200" : "text-neutral-500")} />
              <div className="min-w-0">
                <p className="truncate text-xs font-black uppercase text-neutral-100">{category.label}</p>
                <p className="truncate text-[10px] font-semibold uppercase text-neutral-500">
                  {CONFIDENCE_LABEL[category.confidence]}
                  {category.confidence === "measured" ? "" : ` / ${category.measuredHours}h seen`}
                </p>
              </div>
              <div className="grid justify-items-end gap-1">
                <p className="text-right text-xs font-black tabular-nums text-neutral-100">
                  {formatWatts(category.watts)}
                </p>
                {ampControl?.categoryId === category.id ? (
                  <div className="flex items-end justify-end gap-3">
                    <AutomationToggle
                      checked={switches.autoOn}
                      hint="The amp is switched on automatically when the Apple TV asks for it"
                      label="Auto On"
                      onChange={(checked) => setAutomationSwitches({ ...switches, autoOn: checked })}
                    />
                    <AutomationToggle
                      checked={switches.autoOff}
                      hint="The amp is switched off automatically when the Apple TV stops asking for it"
                      label="Auto Off"
                      onChange={(checked) => setAutomationSwitches({ ...switches, autoOff: checked })}
                    />
                  </div>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmDialog
        busy={busy}
        copy={confirmCopy}
        onCancel={() => setProposed(null)}
        onConfirm={move}
        open={proposed !== null}
      />
    </section>
  );
}

/**
 * One of the amp row's two switches — may this automation switch the amp **on**,
 * and may it switch it **off** (specs/amp-appletv-power.md §7).
 *
 * It annotates a reading rather than being a setting of its own, so it is the
 * compact checkbox the config surfaces already use for exactly that job: a
 * visually-hidden input over an 18px box, under a 9px muted tag
 * (`.cyber-mini-checkbox`, `.rect-envelope-tag`, `RandomTargetToggle`). Not
 * `CheckboxRow`, which is a full-width row for a page of settings.
 */
function AutomationToggle({
  checked,
  hint,
  label,
  onChange,
}: {
  checked: boolean;
  hint: string;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="grid cursor-pointer justify-items-end gap-1" title={hint}>
      <span className="rect-envelope-tag" aria-hidden="true">
        {label}
      </span>
      <input
        type="checkbox"
        className="cyber-mini-checkbox-input"
        checked={checked}
        aria-label={label}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="cyber-mini-checkbox" aria-hidden="true">
        <Check className="h-3 w-3" strokeWidth={3.5} />
      </span>
    </label>
  );
}
