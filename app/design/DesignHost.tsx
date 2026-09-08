"use client";

/**
 * Mounts whichever design is active.
 *
 * The `key` is load-bearing: swapping designs must fully unmount the outgoing
 * one so its local state and any effects it started are discarded, rather than
 * React trying to reconcile two unrelated trees.
 */
import { useActiveDesignId } from "./activeDesign";
import { resolveDesign } from "./registry";

export function DesignHost() {
  const activeId = useActiveDesignId();
  const design = resolveDesign(activeId);
  const Root = design.Root;

  return <Root key={design.manifest.id} />;
}
