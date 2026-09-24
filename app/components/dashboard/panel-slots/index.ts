/**
 * The panel-slot package's facade (specs/control-modules.md).
 *
 * Four things a dashboard mounts together — the host a panel wraps its body in,
 * the provider that gives every panel's slots their state, the hook that builds
 * the view, and the hook that resolves a surface's items — kept behind one import
 * so a caller reads one line rather than four paths. The bodies live beside it.
 */
export { PanelSlots } from "./PanelSlots";
export { SlotViewProvider } from "./slotViewContext";
export { useDashboardSlotView } from "./useDashboardSlotView";
export { useSlotItems } from "./useSlotItems";
