import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readCss } from "../styles/readCss";

// Contract tripwire for the laundry page's chrome and its paper
// (specs/power-meters.md §5.3).
//
// The page is a document rather than a surface of the dashboard: it is read on
// somebody else's phone and printed, so the body-level chrome the layout mounts on
// every route — the status orb above all, and the first-run chooser — is left off
// it. `DashboardGlobalServices` owns that decision, and a rendered frame is the
// real proof: a screenshot of /laundry while the orb was still mounted is what
// found the defect. These assertions pin the decision and the palette, because
// neither has a runtime handle in jsdom and the next edit to either file could
// quietly put the dashboard back on the bill.

const appDir = join(__dirname, "..");
const globalServices = readFileSync(join(appDir, "components", "DashboardGlobalServices.tsx"), "utf8");
const globalsCss = readCss();

/** The `if (standalone === …) {` condition that returns the minimal chrome. */
function standaloneGuard(source: string) {
  const match = source.match(/if \(standalone === [^\n]*?\) \{/);
  if (!match) throw new Error("DashboardGlobalServices has no standalone-route guard");
  return match[0];
}

describe("the laundry page's chrome", () => {
  it("is left off the body-level chrome the layout mounts on every route", () => {
    const guard = standaloneGuard(globalServices);

    // The bill's path **and everything under it**: one wash's own sheet lives there
    // and is the same document (§5.3). Read off the file rather than the guard's
    // own line, because that condition names the path once and then tests a
    // variable.
    expect(globalServices).toContain('standalone === "/laundry"');
    expect(globalServices).toContain('standalone?.startsWith("/laundry/")');
    expect(guard).toContain("onLaundry");
    // The orb is mounted after that guard, so a route the guard covers never
    // reaches it. The import has no angle bracket, so this finds the JSX.
    expect(globalServices.indexOf("<NovaAvatar")).toBeGreaterThan(globalServices.indexOf(guard));
    expect(globalServices.indexOf("<ExperienceModeModal />")).toBeGreaterThan(globalServices.indexOf(guard));
  });

  it("is left off the lighting tint the layout blends over every route", () => {
    // The room's light colour over a printed bill is somebody else's dashboard.
    const overlay = readFileSync(join(appDir, "components", "LightingTintOverlay.tsx"), "utf8");
    const guard = overlay.match(/if \(pathname === [^\n]*?\) return null;/);

    expect(guard?.[0]).toContain('"/laundry"');
    // One wash's own sheet is the same paper, one path below the bill's (§5.3).
    expect(guard?.[0]).toContain('startsWith("/laundry/")');
  });

  it("keeps one wash's sheet renderable in the demo's static export, off the store", () => {
    // The demo build is a static export with no server, so a dynamic route needs
    // the paths its export can carry, and the page must render without reading the
    // build machine's real data directory — the shape the bill already has (§5.3).
    const page = readFileSync(join(appDir, "laundry", "[id]", "page.tsx"), "utf8");

    expect(page).toContain("export function generateStaticParams()");
    expect(page).toContain('colorScheme: "only light"');
    expect(page).toContain("isDemoMode ?");
  });

  it("asks the browser not to repaint it with its automatic dark theme", () => {
    // The bill is paper. A browser whose device is in dark mode repaints a page it
    // reads as light — white text on black over a document meant to be printed —
    // and `only light` is the documented opt-out. It has to be in the head as well
    // as in the CSS: Chromium bases its forced-dark opt-out on the meta tag. The
    // dashboard wants the opposite and declares `dark` for every other route,
    // which is why that value is a `viewport` field a page can override.
    const page = readFileSync(join(appDir, "laundry", "page.tsx"), "utf8");
    const layout = readFileSync(join(appDir, "layout.tsx"), "utf8");

    expect(page).toContain('colorScheme: "only light"');
    expect(layout).toContain('colorScheme: "dark"');
    expect(layout).not.toContain('name="color-scheme"');

    const root = globalsCss.slice(globalsCss.indexOf("html:has(.laundry-page)"));
    expect(root.slice(0, 600)).toContain("color-scheme: only light");
  });

  it("carries no dashboard frontend code of its own", () => {
    // The page renders its own document: a plain <select> rather than the app's
    // themed, portalled listbox, and no component of the dashboard's at all. A
    // bill that borrows one is the dashboard sitting on the paper.
    for (const file of [
      "page.tsx",
      "laundry-client.tsx",
      "laundry-row.tsx",
      "wash-table.tsx",
      "wash-graph.tsx",
      "bill-format.ts",
      join("[id]", "page.tsx"),
    ]) {
      const source = readFileSync(join(appDir, "laundry", file), "utf8");
      // Any import that reaches into the dashboard's components, aliased or
      // relative — the earlier form only matched `../` and `./`.
      const componentImports = [...source.matchAll(/from\s+"([^"]*components\/[^"]*)"/g)].map((match) => match[1]);
      expect(componentImports, `${file} imports a dashboard component`).toEqual([]);
      // Comments are allowed to name the dashboard — that is how the next reader
      // learns why it is not here. The code is not. Block comments go; then whole
      // comment LINES only, so a trailing comment cannot blank the code beside it.
      const code = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .split("\n")
        .filter((line) => !line.trim().startsWith("//"))
        .join("\n");
      expect(code, `${file} uses the dashboard's picker`).not.toContain("ConfigSelect");
      expect(code, `${file} reaches for a theme variable`).not.toContain("--cyber-");
    }
  });
});

describe("the laundry page's paper", () => {
  it("declares its own colours rather than taking the theme's", () => {
    // The page's partial is part of the bundle readCss returns, so this is the
    // shipped stylesheet rather than the file as written.
    const sheet = globalsCss.slice(globalsCss.indexOf(".laundry-page {"));
    const palette = sheet.slice(0, sheet.indexOf("}"));

    expect(palette).toContain("--bill-ink");
    for (const token of ["--bill-muted", "--bill-rule", "--bill-shade"]) {
      expect(palette, `${token} is not declared on .laundry-page`).toContain(token);
    }
    // Nothing on the page may reach for the dashboard's theme variables: a bill
    // that repaints with the theme is the defect this rule exists to prevent.
    const laundryRules = globalsCss.match(/\.laundry-[^{]*\{[^}]*\}/g)?.join("\n") ?? "";
    expect(laundryRules).not.toMatch(/var\(--cyber-/);
  });

  it("paints each wash with the colour of the person who claimed it", () => {
    // Adeline, 2026-09-27: "use the background colour associated with the user
    // claiming it". The colour is the store's answer, through the month view's
    // own lookup, so the page cannot show a person the panel would not.
    // The table is a sibling of the page — the bill's own file is against the 10 KB
    // cap — so the row's colour is read where the row is drawn.
    const table = readFileSync(join(appDir, "laundry", "wash-table.tsx"), "utf8");

    expect(table).toContain("style={{ background: claimBackground(washClaimColor(cycle.person, people)) }}");
  });

  it("has a temperature column, and the claim field's width follows the columns", () => {
    // The column is last-but-one now and the claim field is last; its width is
    // keyed to that, not to an index that moves when a column arrives (§5.3).
    const table = readFileSync(join(appDir, "laundry", "wash-table.tsx"), "utf8");

    expect(table).toContain('<th scope="col" className="is-temp">Temp</th>');
    expect(table).toContain("{temperatureLabel(cycle.temperature)}");
    expect(globalsCss).toContain(".laundry-table th:last-child {");
  });

  it("asks for the print sheet's shades explicitly", () => {
    const printRules = globalsCss.slice(globalsCss.indexOf("@media print"));

    expect(printRules).toContain(".laundry-bar");
    expect(printRules).toContain("display: none");
    expect(printRules).toContain(".laundry-who-printed");
    expect(printRules).toContain("print-color-adjust: exact");
  });
});
