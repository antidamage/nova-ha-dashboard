"use client";

import { ArrowDownUp, Download, Upload } from "lucide-react";
import type { ReactNode, RefObject } from "react";
import { ConfigAccordion } from "../../ConfigControls";
import { downloadJson } from "./system-data-model";

function ToolbarButton({
  children,
  disabled,
  onClick,
}: {
  children: ReactNode;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className="config-page-button"
      disabled={disabled}
      type="button"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// The System & Data "Config Import/Export" accordion.
export function ConfigTransferAccordion({
  busy,
  config,
  fileInputRef,
  importFile,
  message,
}: {
  busy: boolean;
  config: unknown;
  fileInputRef: RefObject<HTMLInputElement | null>;
  importFile: (file: File | null) => Promise<void>;
  message: string | null;
}) {
  return (
        <ConfigAccordion id="config-transfer" title="Config Import/Export" icon={<ArrowDownUp className="config-accordion-icon h-5 w-5" aria-hidden="true" />} className="config-panel zone-panel relative border border-neutral-700 bg-neutral-950/70 shadow-2xl">
          <div className="panel-corner panel-corner-left" />
          <div className="panel-corner panel-corner-right" />
          <div className="config-import-export-actions">
            <ToolbarButton disabled={!config || busy} onClick={() => downloadJson("dashboard-config.json", config)}>
              <Download className="h-4 w-4" />
              Export
            </ToolbarButton>
            <ToolbarButton disabled={busy} onClick={() => fileInputRef.current?.click()}>
              <Upload className="h-4 w-4" />
              Import
            </ToolbarButton>
            <input
              ref={fileInputRef}
              aria-label="Config import file"
              className="sr-only"
              type="file"
              accept="application/json,.json"
              onChange={(event) => void importFile(event.target.files?.[0] ?? null)}
            />
          </div>
          {message ? <p className="mt-3 text-sm font-semibold text-neutral-300">{message}</p> : null}
        </ConfigAccordion>
  );
}
