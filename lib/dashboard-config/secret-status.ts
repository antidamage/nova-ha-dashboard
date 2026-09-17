// Setup status for the credentials an install may or may not have configured.
// Reports presence, never a value.
import { readDashboardConfig } from "./store";
import type { SecretSetupStatus } from "../config-schema";

export async function readSecretSetupStatus(): Promise<SecretSetupStatus> {
  const config = await readDashboardConfig();
  const iCloudUsernameConfigured = Boolean(process.env.ICLOUD_USERNAME?.trim());
  const iCloudAppPasswordConfigured = Boolean(process.env.ICLOUD_APP_PASSWORD?.trim());
  const powershopEmailConfigured = Boolean(process.env.POWERSHOP_EMAIL?.trim());
  const powershopPasswordConfigured = Boolean(process.env.POWERSHOP_PASSWORD?.trim());

  return {
    homeAssistant: {
      urlConfigured: Boolean(process.env.HA_URL?.trim()),
      tokenConfigured: Boolean(process.env.HA_TOKEN?.trim()),
    },
    iCloud: {
      usernameConfigured: iCloudUsernameConfigured,
      appPasswordConfigured: iCloudAppPasswordConfigured,
      enabled: iCloudUsernameConfigured && iCloudAppPasswordConfigured,
    },
    powershop: {
      emailConfigured: powershopEmailConfigured,
      passwordConfigured: powershopPasswordConfigured,
      enabled: powershopEmailConfigured && powershopPasswordConfigured,
    },
    mcp: {
      authRequired: config.mcp.requireBearerAuth,
      bearerTokenConfigured: Boolean(process.env.NOVA_DASHBOARD_MCP_TOKEN?.trim()),
    },
  };
}
