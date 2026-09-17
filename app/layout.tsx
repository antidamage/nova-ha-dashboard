/**
 * Root layout. Helpers live in app/shell/:
 *
 *   shell/layout-data.ts            demo-mode flags, public-asset path rewriting,
 *                                   server reads for the first paint (orb theme, agent name)
 *   shell/head-bootstrap-script.ts  the pre-hydration theme / lite-mode <head> script
 */
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AgentNameProvider } from "./components/AgentNameContext";
import { LoginProvider } from "./components/auth/LoginProvider";
import { DashboardGlobalServices } from "./components/DashboardGlobalServices";
import { LightingTintOverlay } from "./components/LightingTintOverlay";
import { ModuleHost } from "./components/modules/ModuleHost";
import { demoConfigBootstrapScript } from "../lib/demo-config";
import { getLatestDashboardSun } from "../lib/dashboard-events";
import { readDefaultDashboardConfig } from "../lib/dashboard-config";
import { googleFontsHref, themeFontStackMap } from "./components/themeFonts";
import demoThemeDefault from "../config/demo-theme.default.json";
import demoThemeLibraryDefault from "../config/demo-theme-library.default.json";
import {
  appleTouchIconSizes,
  demoThemeLibraryWithAssetPaths,
  demoThemeWithAssetPaths,
  isDemoMode,
  publicAssetPath,
  readInitialAgentName,
  readInitialOrbTheme,
} from "./shell/layout-data";
import { headBootstrapScript } from "./shell/head-bootstrap-script";

// viewportFit "cover" draws the page under the iOS status bar / Dynamic Island.
// Without it Safari fills that strip with its own tint colour. Top-fixed chrome
// already offsets itself with env(safe-area-inset-top) in globals.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

// Where the Outside camera stream is embedded FROM. Capture now lives on
// Nocturnium; nova is a pure consumer. Seed the
// configured host onto the client so CameraPanel/CameraConfig know whether to
// use the server-side same-origin camera proxy (see cameraHost.ts). Empty means
// the recorder on this dashboard host is used instead.
export async function generateMetadata(): Promise<Metadata> {
  const agentName = await readInitialAgentName();
  return {
    title: isDemoMode ? "Nova — Interactive Smart Home Demo" : `${agentName} Control`,
    description: isDemoMode ? "Explore Nova's room controls, energy dashboard, reminders, camera review and custom voice personalities in an interactive fictional household." : `Zone-based Home Assistant controls for ${agentName}`,
    // Added to the iOS Home Screen, the dashboard runs as a standalone web app.
    // Without `black-translucent` iOS reserves the clock/battery strip and fills
    // it with a colour sampled from the page background — which tracks whatever
    // the theme's background colour happens to be, so it reads as a random
    // dashboard colour above the page. `black-translucent` makes the page itself
    // draw under that strip (with viewportFit "cover" above); `.dashboard-home`
    // pads its top by env(safe-area-inset-top) so nothing hides behind the clock.
    appleWebApp: {
      capable: true,
      // No `title`: that writes apple-mobile-web-app-title and would rename an
      // already-installed home-screen icon.
      statusBarStyle: "black-translucent",
    },
    icons: {
      icon: publicAssetPath("/favicon.ico"),
      apple: [
        ...appleTouchIconSizes.map((size) => ({
          url: publicAssetPath(`/apple-touch-icon-${size}x${size}.png`),
          sizes: `${size}x${size}`,
          type: "image/png",
        })),
        { url: publicAssetPath("/apple-touch-icon.png"), sizes: "180x180", type: "image/png" },
      ],
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const demoMode = isDemoMode;
  const [initialOrbTheme, initialAgentName] = await Promise.all([
    readInitialOrbTheme(),
    readInitialAgentName(),
  ]);
  // Real sun status (from the event poller's last state build) so an "auto"
  // theme selection resolves the correct dark/light variant on the very first
  // paint. Without it, both the head bootstrap and the SSR'd orb text fall
  // back to an hour-of-day guess evaluated on the SERVER clock — wrong for
  // most of the local day when the container runs in UTC. Null before the
  // poller has produced a state (fresh boot) and in demo mode.
  const initialSun = demoMode ? null : getLatestDashboardSun();
  const serverSunJson = JSON.stringify(initialSun ?? null).replace(/</g, "\\u003c");
  const demoProviderBase = process.env.NEXT_PUBLIC_NOVA_DEMO_PROVIDER_BASE ?? "https://example.github.io/nova-dummy-data-provider/";
  const demoBootstrapScript = demoMode
    ? demoConfigBootstrapScript(
        await readDefaultDashboardConfig(),
        demoProviderBase,
        demoThemeWithAssetPaths(demoThemeDefault),
        demoThemeLibraryWithAssetPaths(demoThemeLibraryDefault),
      )
    : null;

  // id -> CSS font stack, injected into the head bootstrap so the saved theme/clock
  // fonts are seeded on the first paint (no flash of the compiled-in default).
  const fontStacksJson = JSON.stringify(themeFontStackMap());

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* Always tells the browser this page is dark, whichever Nova theme is
            selected, so Chromium's auto dark mode (a Brave flag Adeline runs)
            leaves it alone. That mode repaints light fills after first paint:
            the ColorEncoder ring went dark as a bright colour was desaturated
            and the lit LED settled to blue-grey, and `!important` and image
            fills are rewritten too. Mirrored on `:root` in globals.css
            (specs/color-encoder.md, "Surviving Brave's auto dark mode"). */}
        <meta name="color-scheme" content="dark" />
        {/* Next's appleWebApp.capable only emits the modern
            `mobile-web-app-capable`, which iOS Safari does not read. iOS still
            requires this exact legacy name, and the black-translucent status
            bar style below it only applies when it is present.
            specs/ios-home-screen-webapp.md. */}
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link rel="stylesheet" href={googleFontsHref()} />
        {demoMode ? (
          <script
            dangerouslySetInnerHTML={{
              __html: `try {${demoBootstrapScript}} catch (_) {}`,
            }}
          />
        ) : null}
        {demoMode ? (
          <script dangerouslySetInnerHTML={{ __html: "window.__NOVA_VIDEO_HOST__=\"\";" }} />
        ) : (
          // A separate no-store route is intentional: the root layout is
          // prerendered, while videoHostUrl is mutable shared runtime config.
          // This parser-blocking script resolves the current host before any
          // camera client code hydrates.
          <script src="/api/camera/bootstrap" />
        )}
        {demoMode ? (
          // Static export has no API routes, so the demo reads the same
          // sessionStorage key its /api/design shim writes (lib/demo-config.ts).
          <script dangerouslySetInnerHTML={{ __html: 'try{var d=window.sessionStorage.getItem("nova.demo.design.v1")||"nova-classic";window.__NOVA_DESIGN__=d;document.documentElement.setAttribute("data-nova-design",d);}catch(_){window.__NOVA_DESIGN__="nova-classic";document.documentElement.setAttribute("data-nova-design","nova-classic");}' }} />
        ) : (
          // Which presentation layer to paint, resolved before first paint so
          // the active design's scoped CSS applies from the first frame. Same
          // reasoning as the camera bootstrap above: the layout is prerendered,
          // so this cannot be read here directly (specs/design-modules.md).
          <script src="/api/design/bootstrap" />
        )}
        <script
          dangerouslySetInnerHTML={{
            __html: headBootstrapScript(serverSunJson, fontStacksJson),
          }}
        />
      </head>
      <body>
        <AgentNameProvider initialName={initialAgentName}>
          <DashboardGlobalServices initialTheme={initialOrbTheme} initialSun={initialSun} />
          {/* Wraps both the dashboard and the config page: module slots, the
              shared confirm dialog and the sign-in modal are needed on each. */}
          <LoginProvider>
            <ModuleHost>{children}</ModuleHost>
          </LoginProvider>
          <LightingTintOverlay />
        </AgentNameProvider>
      </body>
    </html>
  );
}
