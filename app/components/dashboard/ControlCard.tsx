"use client";

import type { ReactNode } from "react";
import type { DashboardEntity } from "../../../lib/types";
import { ModuleSlot } from "../modules/ModuleSlot";
import { classNames } from "./shared";

/**
 * The dashboard's generic control-card wrapper: kicker, title, state pill, and
 * a body that is replaced by "Entity missing" when the card has no entity.
 *
 * This began as a private `ClimateCard` inside `ClimateControls.tsx`. It was
 * lifted out because it is the host for the module system's card hooks
 * (`specs/module-system.md` §3.1) — modules target a card by its `cardId`, so
 * every card needs a stable one whether or not it is a climate card.
 */
export type ControlCardProps = {
  /** Stable identity for this card. Module slots target it. */
  cardId: string;
  children?: ReactNode;
  entity?: DashboardEntity;
  kicker: string;
  title: string;
};

export function ControlCard({ cardId, children, entity, kicker, title }: ControlCardProps) {
  const unavailable = entity ? ["unknown", "unavailable"].includes(entity.state) : true;

  return (
    <section className="climate-card border border-neutral-700 bg-neutral-950/70 p-5" data-card-id={cardId}>
      <header className="mb-5 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-black uppercase text-cyan-300">{kicker}</p>
          <h2 className="mt-1 truncate text-3xl font-black uppercase text-neutral-50">{title}</h2>
        </div>
        <div className="flex items-center gap-2">
          <ModuleSlot id="card.header.actions" context={{ cardId, entity }} />
          <div
            className={classNames(
              "border px-3 py-2 text-xs font-black uppercase",
              unavailable ? "border-red-400/50 text-red-400" : "border-cyan-300/50 text-cyan-200",
            )}
          >
            {entity?.state ?? "missing"}
          </div>
        </div>
      </header>

      {entity ? children : <p className="text-sm font-black uppercase text-neutral-400">Entity missing</p>}
      <ModuleSlot id="card.body.after" context={{ cardId, entity }} />
      <ModuleSlot id="card.footer" context={{ cardId, entity }} />
    </section>
  );
}
