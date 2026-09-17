"use client";

import { CheckboxRow } from "../ConfigControls";
import type { TreeNode } from "./types";

/**
 * One branch of the config as it stood at the chosen moment.
 *
 * Every branch is offered, not only the ones that revision touched — the
 * question being answered is "put this back to how it was then", which is a
 * fair question about a branch nothing happened to. Selecting a parent covers
 * everything under it, so its children are disabled rather than hidden: the
 * user can still see what they are about to take.
 */
export function TreeRow({
  covered,
  depth,
  node,
  onToggle,
  selected,
}: {
  covered: boolean;
  depth: number;
  node: TreeNode;
  onToggle: (pointer: string, checked: boolean) => void;
  selected: Set<string>;
}) {
  const isSelected = selected.has(node.pointer);
  const detail = [
    node.kind === "array" ? `${node.size ?? 0} item${node.size === 1 ? "" : "s"}`
      : node.kind === "object" ? `${node.size ?? 0} setting${node.size === 1 ? "" : "s"}`
      : "value",
    node.changed ? "changed in this revision" : null,
    node.status === "missing-now" ? "gone now — restoring brings it back" : null,
    node.status === "added-since" ? "added since — restoring removes it" : null,
  ].filter(Boolean).join(" · ");

  return (
    <div style={{ marginLeft: depth * 16 }} className="grid gap-1">
      <div className="flex items-center gap-2">
        {node.changed ? (
          <span
            aria-hidden
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300"
            title="Changed in this revision"
          />
        ) : (
          <span aria-hidden className="h-1.5 w-1.5 shrink-0" />
        )}
        <div className="min-w-0 flex-1">
          <CheckboxRow
            checked={isSelected || covered}
            disabled={covered}
            detail={detail}
            label={node.label}
            onChange={(checked) => onToggle(node.pointer, checked)}
          />
        </div>
      </div>
      {node.children?.map((child) => (
        <TreeRow
          key={child.pointer}
          covered={covered || isSelected}
          depth={depth + 1}
          node={child}
          onToggle={onToggle}
          selected={selected}
        />
      ))}
    </div>
  );
}
