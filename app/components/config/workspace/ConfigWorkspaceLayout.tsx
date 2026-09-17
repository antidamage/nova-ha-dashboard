"use client";

import type { ReactNode, RefObject } from "react";
import type { SunThemeStatus, ThemeStorageValue } from "../../accentColor";
import { ConfigBreadcrumb } from "../../ConfigBreadcrumbBar";
import { ConfigPreviewBackground, ConfigPreviewBackgroundProvider } from "../../ConfigPreviewBackground";
import { ReloadButton } from "../../ReloadButton";
import { UpdateBanner } from "../../UpdateBanner";
import { ConfigCategoryNav } from "./ConfigCategoryNav";
import { ConfigPageActions } from "./ConfigPageActions";
import type { ConfigCategoryId } from "./types";

// Page chrome for /config: themed preview background, the top and bottom
// action bars, the category nav, the breadcrumb and the open category's
// heading. The category's own sections are passed in as children.
export function ConfigWorkspaceLayout({
  activeCategory,
  activeMeta,
  categoryNavRef,
  children,
  initialSun,
  initialTheme,
  onBack,
  selectCategory,
}: {
  activeCategory: ConfigCategoryId | null;
  activeMeta: { detail: string; label: string } | undefined;
  categoryNavRef: RefObject<HTMLElement | null>;
  children: ReactNode;
  initialSun?: SunThemeStatus | null;
  initialTheme?: ThemeStorageValue | null;
  onBack: () => void;
  selectCategory: (category: ConfigCategoryId) => void;
}) {
  return (
    <ConfigPreviewBackgroundProvider initialSun={initialSun} initialTheme={initialTheme}>
      <main className="dashboard-shell config-shell min-h-screen px-4 py-5 text-neutral-100 sm:px-6" style={{ backgroundColor: "var(--cyber-bg)" }}>
        <ConfigPreviewBackground />
        <ReloadButton />
        <div className={`config-layout mx-auto grid max-w-5xl gap-4 ${activeCategory ? "" : "config-layout-categories-closed"}`}>
        <UpdateBanner context="config" />
        <nav className="config-top-actions" aria-label="Configuration actions">
          <ConfigPageActions onBack={onBack} />
        </nav>

        <ConfigCategoryNav activeCategory={activeCategory} categoryNavRef={categoryNavRef} selectCategory={selectCategory} />

        <ConfigBreadcrumb
          activeCategory={activeCategory}
          categoryLabel={activeMeta?.label ?? null}
          onSelectRoot={() => activeCategory && selectCategory(activeCategory)}
        />

        {activeCategory ? (
          <div id="config-category-content" className="config-category-content grid gap-4" data-category={activeCategory}>
            <header className="config-category-heading">
              <p className="config-category-kicker">Configuration</p>
              <h1>{activeMeta?.label}</h1>
              <p>{activeMeta?.detail}</p>
            </header>

            {children}
          </div>
        ) : null}
        </div>
        <nav className="config-bottom-actions" aria-label="Configuration actions (bottom)">
          <ConfigPageActions onBack={onBack} />
        </nav>
      </main>
    </ConfigPreviewBackgroundProvider>
  );
}
