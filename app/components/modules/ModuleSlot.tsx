"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { useModuleRuntime, type SlotContext } from "./ModuleHost";
import type { SlotId } from "../../../lib/modules/runtime/types";

/**
 * A render point modules can contribute to (`specs/module-system.md` §3.1).
 *
 * Every contribution is wrapped in its own error boundary: a module that throws
 * while rendering disappears from the slot and is logged, rather than blanking
 * the panel it was sitting in.
 */
class SlotBoundary extends Component<
  { children: ReactNode; moduleId: string; slotId: string },
  { failed: boolean }
> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(
      `[nova-modules] ${this.props.moduleId} threw rendering slot ${this.props.slotId}`,
      error,
      info.componentStack,
    );
  }

  render() {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Calls the module's render function during ITS own render, so the boundary
 * above is an ancestor when it throws. Invoking it in `ModuleSlot` and passing
 * the result as children would put the throw outside the boundary, where it
 * takes the whole tree down — which is exactly the failure this exists to stop.
 */
function SlotContribution({
  context,
  render,
}: {
  context: SlotContext;
  render: (context: SlotContext) => ReactNode;
}) {
  return <>{render(context)}</>;
}

export function ModuleSlot({ id, context }: { id: SlotId; context?: SlotContext }) {
  const { slots } = useModuleRuntime();
  const registrations = slots.get(id);
  if (!registrations?.length) {
    return null;
  }
  return (
    <>
      {registrations.map((registration) => (
        <SlotBoundary key={registration.key} moduleId={registration.moduleId} slotId={id}>
          <SlotContribution context={context ?? {}} render={registration.render} />
        </SlotBoundary>
      ))}
    </>
  );
}
