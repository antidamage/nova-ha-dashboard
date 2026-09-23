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
import { useConfigHeaderFade } from "./useConfigHeaderFade";

// Page chrome for /config: themed preview background, the fixed header band
// (Reload / Back / Log out plus the theme's Orb Shadow behind them), the
// category nav, the breadcrumb and the open category's heading. The category's
// own sections are passed in as children.
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
  // This page has no status orb, so the strip's usual driver is absent —
  // specs/config-page-header.md.
  useConfigHeaderFade();

  return (
    <ConfigPreviewBackgroundProvider initialSun={initialSun} initialTheme={initialTheme}>
      <main className="dashboard-shell config-shell min-h-screen px-4 py-5 text-neutral-100 sm:px-6" style={{ backgroundColor: "var(--cyber-bg)" }}>
        <ConfigPreviewBackground />
        {/* The theme's Orb Shadow, at full viewport width and fixed behind the
            header band; the scroll handler above gives it its opacity. */}
        <div className="header-fade-strip" aria-hidden="true" />
        <ReloadButton />
        {/* The header band: Back / Log out and the trail, as direct children of
            the shell rather than of `.config-layout`. They have to stay out of
            that column: background.css gives every other direct child of the
            shell `position: relative; z-index: 1`, which makes the column a
            stacking context — and a z-index inside one only orders its own
            siblings, so the whole column (trail and buttons included) would paint
            UNDER the strip, at 1, however high their own z-indexes went.
            specs/config-page-header.md. */}
        <div className="config-header-band">
          <nav aria-label="Configuration actions">
            <ConfigPageActions onBack={onBack} />
          </nav>
          <ConfigBreadcrumb
            activeCategory={activeCategory}
            categoryLabel={activeMeta?.label ?? null}
            onSelectRoot={() => activeCategory && selectCategory(activeCategory)}
          />
        </div>
        <div className={`config-layout mx-auto grid max-w-5xl gap-4 ${activeCategory ? "" : "config-layout-categories-closed"}`}>
        {/* The band's space in the page column: the icons and the trail are fixed
            to the viewport, so this row reserves their band rather than holding
            their boxes, and no page content can start underneath them. */}
        <div className="config-header-band-spacer" aria-hidden="true" />
        <UpdateBanner context="config" />

        <ConfigCategoryNav activeCategory={activeCategory} categoryNavRef={categoryNavRef} selectCategory={selectCategory} />

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
      </main>
    </ConfigPreviewBackgroundProvider>
  );
}
