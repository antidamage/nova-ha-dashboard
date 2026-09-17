"use client";

import { KeyRound, ShieldAlert } from "lucide-react";
import { ConfigAccordion } from "../../ConfigControls";
import { ThemeChangeNotificationSecret } from "../../ThemeChangeNotificationSecret";
import type { setupRows } from "./system-data-model";

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span className={ok ? "text-cyan-200" : "text-yellow-200"}>
      {ok ? "ready" : "needed"}
    </span>
  );
}

// The System & Data "Secrets" accordion: which required secrets are configured.
export function SecretsAccordion({ rows }: { rows: ReturnType<typeof setupRows> }) {
  return (
        <ConfigAccordion id="secrets" title="Secrets" icon={<KeyRound className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
          <div className="panel-corner panel-corner-left" />
          <div className="panel-corner panel-corner-right" />
          <div className="mb-4 flex items-center gap-2 text-yellow-100">
            <ShieldAlert className="h-5 w-5" />
            <h2 className="text-lg font-black uppercase">Secrets</h2>
          </div>
          <div className="grid gap-3">
            <ThemeChangeNotificationSecret />
            {rows.map((row) => (
              <div key={row.detail} className="flex items-center justify-between gap-3 border-b border-neutral-800 pb-2 text-sm">
                <div>
                  <p className="font-black uppercase text-neutral-100">{row.label}</p>
                  <p className="font-mono text-xs text-neutral-500">{row.detail}</p>
                </div>
                <StatusPill ok={row.ok} />
              </div>
            ))}
          </div>
        </ConfigAccordion>
  );
}
