import type { HTMLAttributes, ReactNode } from "react";

export type Axis = "x" | "y";
export type Tag = "div" | "section";

export type AdvancedFoldProps = Omit<HTMLAttributes<HTMLElement>, "children" | "className"> & {
  /** What sits past the line. Omitted or null: a plain scroller with no fold. */
  advanced?: ReactNode;
  children: ReactNode;
  className?: string;
  /** The element the scroller is rendered as. */
  as?: Tag;
};
