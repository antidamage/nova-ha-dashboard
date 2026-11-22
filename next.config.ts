import { copyFileSync, mkdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

// MapLibre's worker is a separate module the bundle cannot find on its own;
// app/components/map/worker-url.ts points MapLibre here. Copied whenever the
// config loads (dev, build, demo build), only when it differs; git-ignored.
function copyMapWorker() {
  const source = path.resolve(__dirname, "node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs");
  const target = path.resolve(__dirname, "public/vendor/maplibre-gl-worker.mjs");
  try {
    const bytes = readFileSync(source);
    let current: Buffer | null = null;
    try {
      current = readFileSync(target);
    } catch {
      current = null;
    }
    if (current && current.equals(bytes)) return;
    mkdirSync(path.dirname(target), { recursive: true });
    copyFileSync(source, target);
  } catch (error) {
    console.warn("[next.config] could not copy the MapLibre worker; vector map layers will not draw", error);
  }
}
copyMapWorker();

const demoMode = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const demoBasePath = process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH?.trim() ?? "";

// Comma-separated extra dev origins (LAN/tailnet hostnames of the dev host);
// deployment values live in the git-ignored PRIVATEREF.md#1.1.
const devOrigins = (process.env.NOVA_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  distDir: process.env.NOVA_NEXT_DIST_DIR || ".next",
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  ...(demoMode
    ? {
        output: "export",
        trailingSlash: true,
        ...(demoBasePath ? { assetPrefix: demoBasePath, basePath: demoBasePath } : {}),
      }
    : {}),
  // This app lives in a sub-directory of a larger repo that has its own
  // package-lock.json, so Turbopack otherwise infers the repo root as the
  // workspace root and traces the whole monorepo.
  turbopack: { root: path.resolve(__dirname) },
  typescript: { tsconfigPath: "tsconfig.build.json" },
  poweredByHeader: false,
  serverExternalPackages: ["ssh2"],
};

export default nextConfig;
