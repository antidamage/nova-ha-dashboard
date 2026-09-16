import type { DashboardConfig } from "./dashboard-config";

export type ConfigValidationIssue = {
  code: string;
  message: string;
  path: string;
};

export type ConfigValidationResult =
  | {
      ok: true;
      config: DashboardConfig;
      errors: [];
    }
  | {
      ok: false;
      config?: undefined;
      errors: ConfigValidationIssue[];
    };

export type ConfigImportResult = ConfigValidationResult & {
  applied: boolean;
};

export type SecretSetupStatus = {
  homeAssistant: {
    urlConfigured: boolean;
    tokenConfigured: boolean;
  };
  iCloud: {
    usernameConfigured: boolean;
    appPasswordConfigured: boolean;
    enabled: boolean;
  };
  powershop: {
    emailConfigured: boolean;
    passwordConfigured: boolean;
    enabled: boolean;
  };
  mcp: {
    bearerTokenConfigured: boolean;
    authRequired: boolean;
  };
};

export type McpToolResult = {
  content: Array<{ type: "text"; text: string }>;
  isError?: boolean;
  structuredContent?: Record<string, unknown>;
};
