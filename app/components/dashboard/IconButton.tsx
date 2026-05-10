"use client";

import * as Tooltip from "@radix-ui/react-tooltip";
import type { ReactNode } from "react";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { classNames } from "./shared";

export function IconButton({
  children,
  label,
  onClick,
  disabled,
  variant = "cyan",
}: {
  children: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "cyan" | "pink" | "yellow" | "white";
}) {
  const variants = {
    cyan: "border-cyan-300/60 bg-cyan-300/10 text-cyan-200 hover:bg-cyan-300/20",
    pink: "border-fuchsia-300/60 bg-fuchsia-300/10 text-fuchsia-200 hover:bg-fuchsia-300/20",
    yellow: "border-yellow-300/60 bg-yellow-300/10 text-yellow-100 hover:bg-yellow-300/20",
    white: "border-neutral-200/70 bg-neutral-100/10 text-neutral-100 hover:bg-neutral-100/20",
  };

  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <MomentaryFeedbackButton
          type="button"
          aria-label={label}
          onPointerDown={(event) => {
            if (event.pointerType === "mouse") {
              return;
            }
            event.preventDefault();
            if (!disabled) {
              onClick();
            }
          }}
          onClick={onClick}
          disabled={disabled}
          className={classNames(
            "flex h-16 min-w-16 touch-manipulation items-center justify-center border text-sm font-black uppercase outline-none transition disabled:cursor-not-allowed disabled:border-neutral-700 disabled:bg-neutral-900 disabled:text-neutral-600",
            variants[variant],
          )}
        >
          {children}
        </MomentaryFeedbackButton>
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content
          sideOffset={8}
          className="border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-semibold text-neutral-200 shadow-xl"
        >
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
