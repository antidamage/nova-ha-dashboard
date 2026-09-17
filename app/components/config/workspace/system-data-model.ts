import type { SecretSetupStatus } from "../../../../lib/config-schema";

function stringify(value: unknown) {
  return JSON.stringify(value, null, 2);
}

export function downloadJson(fileName: string, value: unknown) {
  const blob = new Blob([`${stringify(value)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function setupRows(status?: SecretSetupStatus) {
  if (!status) {
    return [];
  }
  return [
    { label: "Home Assistant URL", ok: status.homeAssistant.urlConfigured, detail: "HA_URL" },
    { label: "Home Assistant token", ok: status.homeAssistant.tokenConfigured, detail: "HA_TOKEN" },
    { label: "iCloud username", ok: status.iCloud.usernameConfigured, detail: "ICLOUD_USERNAME" },
    { label: "iCloud app password", ok: status.iCloud.appPasswordConfigured, detail: "ICLOUD_APP_PASSWORD" },
    { label: "Powershop email", ok: status.powershop.emailConfigured, detail: "POWERSHOP_EMAIL" },
    { label: "Powershop password", ok: status.powershop.passwordConfigured, detail: "POWERSHOP_PASSWORD" },
    { label: "MCP bearer token", ok: !status.mcp.authRequired || status.mcp.bearerTokenConfigured, detail: "NOVA_DASHBOARD_MCP_TOKEN" },
  ];
}
