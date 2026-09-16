/** Configuration accordion event names. */
export const CONFIG_ACCORDION_OPEN_EVENT = "nova-config-accordion-open";
// Mirrors the open event so a fold (not just an unfold) is observable — the
// breadcrumb chain computation needs to know when the deepest-open leaf
// collapses, not only when a new one opens.
export const CONFIG_ACCORDION_CLOSE_EVENT = "nova-config-accordion-close";
