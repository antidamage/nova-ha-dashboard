"use client";

import type { RefObject } from "react";
import { CONFIG_CATEGORIES } from "./constants";
import type { ConfigCategoryId } from "./types";

// The category button row at the top of the config page.
export function ConfigCategoryNav({
  activeCategory,
  categoryNavRef,
  selectCategory,
}: {
  activeCategory: ConfigCategoryId | null;
  categoryNavRef: RefObject<HTMLElement | null>;
  selectCategory: (category: ConfigCategoryId) => void;
}) {
  return (
        <nav
          ref={categoryNavRef}
          className="config-category-nav"
          aria-label="Configuration categories"
          data-nova-no-drag-scroll
        >
          {CONFIG_CATEGORIES.map(({ detail, icon: Icon, id, label }) => {
            const selected = activeCategory === id;
            return (
              <button
                key={id}
                type="button"
                className={`config-category-button ${selected ? "config-category-button-active" : ""}`}
                aria-expanded={selected}
                aria-controls="config-category-content"
                onClick={() => selectCategory(id)}
              >
                <Icon className="h-5 w-5 shrink-0" aria-hidden="true" />
                <span className="grid gap-1 text-left">
                  <span className="config-category-label">{label}</span>
                  <span className="config-category-detail">{detail}</span>
                </span>
              </button>
            );
          })}
        </nav>
  );
}
