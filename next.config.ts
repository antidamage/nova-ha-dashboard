import type { NextConfig } from "next";

const demoMode = process.env.NEXT_PUBLIC_NOVA_DEMO_MODE === "true";
const demoBasePath = process.env.NEXT_PUBLIC_NOVA_DEMO_BASE_PATH?.trim() ?? "";

// Comma-separated extra dev origins (LAN/tailnet hostnames of the dev host);
// deployment values live in the git-ignored PRIVATEREF.md#1.1.
const devOrigins = (process.env.NOVA_DEV_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const nextConfig: NextConfig = {
  ...(devOrigins.length > 0 ? { allowedDevOrigins: devOrigins } : {}),
  ...(demoMode
    ? {
        output: "export",
        trailingSlash: true,
        ...(demoBasePath ? { assetPrefix: demoBasePath, basePath: demoBasePath } : {}),
      }
    : {}),
  poweredByHeader: false,
  serverExternalPackages: ["ssh2"],
};

export default nextConfig;
