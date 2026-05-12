import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["nova.local", "nova.tuatara-dory.ts.net"],
  poweredByHeader: false,
};

export default nextConfig;
