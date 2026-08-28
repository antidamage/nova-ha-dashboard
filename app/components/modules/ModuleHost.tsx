"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { jsx, jsxs, Fragment } from "react/jsx-runtime";
import { ConfirmDialog, type ConfirmCopy } from "../ConfirmDialog";
import { ModalOverlay } from "../ModalOverlay";
import { MomentaryFeedbackButton } from "../MomentaryFeedbackButton";
import { CheckboxRow, SliderControlPanel } from "../ConfigControls";
import { ConfigSelect } from "../ConfigSelect";
import { ControlCard } from "../dashboard/ControlCard";
import { importModuleClient } from "./moduleImport";
import { IconButton } from "../dashboard/IconButton";
import {
  isInterceptId,
  isSlotId,
  type InterceptContext,
  type InterceptDecision,
  type ModuleConfirmRequest,
  type ModuleEvent,
  type ModuleSummary,
} from "../../../lib/modules/runtime/types";

/**
 * The client half of the module system (`specs/module-system.md` §2, §10).
 *
 * Enabled modules' `client.mjs` bundles are imported at runtime and handed a
 * registration API carrying the host's React, the JSX runtime, and the shared
 * component set. Modules must NOT bundle their own React — two copies break
 * hooks — which is why those come through the API rather than being imported by
 * the module.
 */

const DEMO_MODE = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";

/** A client interceptor that has not settled in this long is treated as "proceed". */
const INTERCEPT_TIMEOUT_MS = 5_000;

export type SlotContext = Record<string, unknown>;
type SlotRenderer = (context: SlotContext) => ReactNode;

type SlotRegistration = { moduleId: string; key: string; render: SlotRenderer };
type InterceptRegistration = {
  moduleId: string;
  handler: (context: InterceptContext) => InterceptDecision | Promise<InterceptDecision>;
};

type ModuleRuntime = {
  slots: Map<string, SlotRegistration[]>;
  intercepts: Map<string, InterceptRegistration[]>;
  modules: ModuleSummary[];
  runIntercepts: (context: InterceptContext) => Promise<boolean>;
};

const EMPTY_RUNTIME: ModuleRuntime = {
  slots: new Map(),
  intercepts: new Map(),
  modules: [],
  runIntercepts: async () => true,
};

const ModuleRuntimeContext = createContext<ModuleRuntime>(EMPTY_RUNTIME);

export function useModuleRuntime() {
  return useContext(ModuleRuntimeContext);
}

/**
 * Run every client interceptor for an action. Returns false when the action must
 * not happen. Callers run this BEFORE any optimistic state write and before the
 * poll hold, so a cancelled action leaves nothing behind.
 */
export function useModuleIntercepts() {
  return useModuleRuntime().runIntercepts;
}

const SHARED_COMPONENTS = {
  CheckboxRow,
  ConfigSelect,
  ConfirmDialog,
  ControlCard,
  IconButton,
  ModalOverlay,
  MomentaryFeedbackButton,
  SliderControlPanel,
};

function withTimeout(
  work: Promise<InterceptDecision>,
  moduleId: string,
  id: string,
): Promise<InterceptDecision> {
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      console.error(`[nova-modules] ${moduleId} intercept ${id} timed out; proceeding`);
      resolve("proceed");
    }, INTERCEPT_TIMEOUT_MS);
    work.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        console.error(`[nova-modules] ${moduleId} intercept ${id} threw; proceeding`, error);
        resolve("proceed");
      },
    );
  });
}

export function ModuleHost({ children }: { children: ReactNode }) {
  const slotsRef = useRef(new Map<string, SlotRegistration[]>());
  const interceptsRef = useRef(new Map<string, InterceptRegistration[]>());
  const [modules, setModules] = useState<ModuleSummary[]>([]);
  // The slot/intercept maps are mutated in place as modules register, so this
  // counter is what tells React the context value changed.
  const [version, setVersion] = useState(0);

  // One dialog for every module, driven by whichever interceptor is asking.
  const [confirmCopy, setConfirmCopy] = useState<ConfirmCopy | null>(null);
  const confirmResolve = useRef<((confirmed: boolean) => void) | null>(null);

  const askConfirm = useCallback((request: ModuleConfirmRequest) => {
    return new Promise<boolean>((resolve) => {
      confirmResolve.current = resolve;
      setConfirmCopy({
        stages: request.stages,
        cancelLabel: request.cancelLabel,
        dismissHint: request.dismissHint,
      });
    });
  }, []);

  const settleConfirm = useCallback((confirmed: boolean) => {
    setConfirmCopy(null);
    const resolve = confirmResolve.current;
    confirmResolve.current = null;
    resolve?.(confirmed);
  }, []);

  const runIntercepts = useCallback(
    async (context: InterceptContext) => {
      const list = interceptsRef.current.get(context.id);
      if (!list?.length) {
        return true;
      }
      for (const { moduleId, handler } of [...list]) {
        const decision = await withTimeout(
          Promise.resolve().then(() => handler(context)),
          moduleId,
          context.id,
        );
        if (decision === "proceed") {
          continue;
        }
        if (decision === "cancel") {
          return false;
        }
        const confirmed = await askConfirm(decision.confirm);
        if (confirmed) {
          decision.confirm.onConfirmed?.();
          continue;
        }
        decision.confirm.onCancelled?.();
        return false;
      }
      return true;
    },
    [askConfirm],
  );

  useEffect(() => {
    // Demo mode is a static export with no module API to ask.
    if (DEMO_MODE) {
      return;
    }
    let alive = true;

    void (async () => {
      let summaries: ModuleSummary[] = [];
      try {
        const response = await fetch("/api/modules", { cache: "no-store" });
        if (!response.ok) {
          return;
        }
        summaries = ((await response.json()) as { modules?: ModuleSummary[] }).modules ?? [];
      } catch {
        // No module API is a supported state — the dashboard is just unextended.
        return;
      }
      if (!alive) {
        return;
      }
      setModules(summaries);

      for (const summary of summaries) {
        if (!summary.enabled || !summary.hasClient || summary.state === "failed") {
          continue;
        }
        try {
          const loaded = await importModuleClient(summary.id, summary.clientVersion);
          if (!alive) {
            return;
          }
          const register = loaded.default?.register;
          if (typeof register !== "function") {
            throw new Error("default export must be an object with a register(api) function");
          }
          await register(buildClientApi(summary));
          setVersion((value) => value + 1);
        } catch (error) {
          // A module that fails to load contributes nothing and is logged. It
          // never takes the dashboard's UI down with it.
          console.error(`[nova-modules] ${summary.id} client failed to load`, error);
        }
      }
    })();

    return () => {
      alive = false;
    };

    function buildClientApi(summary: ModuleSummary) {
      const moduleId = summary.id;
      let slotSeq = 0;
      return {
        id: moduleId,
        version: summary.version,
        react: React,
        jsx,
        jsxs,
        Fragment,
        components: SHARED_COMPONENTS,

        slot(hookId: string, render: SlotRenderer) {
          if (!isSlotId(hookId)) {
            throw new Error(`${moduleId}: "${hookId}" is not a slot id`);
          }
          if (!summary.hooks.includes(hookId)) {
            throw new Error(`${moduleId}: slot "${hookId}" is not declared in module.json hooks`);
          }
          const list = slotsRef.current.get(hookId) ?? [];
          slotSeq += 1;
          list.push({ moduleId, key: `${moduleId}:${slotSeq}`, render });
          slotsRef.current.set(hookId, list);
        },

        intercept(hookId: string, handler: InterceptRegistration["handler"]) {
          if (!isInterceptId(hookId)) {
            throw new Error(`${moduleId}: "${hookId}" is not an intercept id`);
          }
          if (!summary.hooks.includes(hookId)) {
            throw new Error(`${moduleId}: intercept "${hookId}" is not declared in module.json hooks`);
          }
          const list = interceptsRef.current.get(hookId) ?? [];
          list.push({ moduleId, handler });
          interceptsRef.current.set(hookId, list);
        },

        on() {
          throw new Error(
            `${moduleId}: events are delivered to the server half. Register api.on in server.mjs.`,
          );
        },

        emit(event: Partial<ModuleEvent>) {
          void fetch("/api/modules/events", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event),
          }).catch(() => undefined);
        },

        /** Fetch scoped to the module's own routes. */
        request(path: string, init?: RequestInit) {
          const suffix = path.startsWith("/") ? path : `/${path}`;
          return fetch(`/api/modules/${moduleId}${suffix}`, init);
        },

        log(level: "debug" | "info" | "warn" | "error", message: string, data?: unknown) {
          const line = `[module:${moduleId}] ${message}`;
          if (level === "error") console.error(line, data ?? "");
          else if (level === "warn") console.warn(line, data ?? "");
          else console.log(line, data ?? "");
        },
      };
    }
  }, []);

  const value = useMemo<ModuleRuntime>(
    () => ({
      slots: slotsRef.current,
      intercepts: interceptsRef.current,
      modules,
      runIntercepts,
    }),
    [modules, runIntercepts, version],
  );

  return (
    <ModuleRuntimeContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(confirmCopy)}
        copy={confirmCopy}
        onCancel={() => settleConfirm(false)}
        onConfirm={() => settleConfirm(true)}
      />
    </ModuleRuntimeContext.Provider>
  );
}
