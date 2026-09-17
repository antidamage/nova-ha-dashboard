import path from "path";

/**
 * On-disk state for installed modules (`specs/module-system.md` §9).
 *
 * These live under `data/` rather than `config/` on purpose: `data/` is excluded
 * from `deploy-nova-dashboard.ps1`'s tar and is never replaced by
 * `nova-release`'s release swap, so an installed module and its config survive
 * both a deploy and a self-update.
 */

export const MODULES_DIR =
  process.env.NOVA_DASHBOARD_MODULES_DIR ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "modules");

// Mirrors installPhonoscopePackage's limits — same threat, same shape of answer.
export const INSTALL_LIMITS = {
  compressedBytes: 10 * 1024 * 1024,
  extractedBytes: 40 * 1024 * 1024,
  fileBytes: 20 * 1024 * 1024,
  fileCount: 200,
};

export const ALLOWED_ASSET_EXTENSIONS = new Set([
  ".png", ".jpg", ".jpeg", ".webp", ".svg", ".woff2", ".json", ".md",
]);
