// Demo-mode configuration fixtures and browser shim — facade. The body lives
// in lib/demo-config/; this file keeps the import path stable for its callers
// (specs/agent-token-footprint.md §3.3).
//
// Where things are:
//
//   demo-config/types.ts             DemoThemeEnvelope, DemoThemeLibrary
//   demo-config/constants.ts         storage keys, the config-change event name
//   demo-config/fixtures-model.ts    demoDashboardConfig/ClientConfig/SecretSetupStatus
//   demo-config/bootstrap-script.ts  demoConfigBootstrapScript — the injected
//                                    fetch/EventSource shim (over 10 KB;
//                                    §2 criterion 3, see that file's header)

export type { DemoThemeEnvelope, DemoThemeLibrary } from "./demo-config/types";

export {
  DEMO_CONFIG_STORAGE_KEY,
  DEMO_THEME_STORAGE_KEY,
  DEMO_THEME_LIBRARY_STORAGE_KEY,
  DEMO_CONFIG_CHANGE_EVENT,
} from "./demo-config/constants";

export { demoDashboardConfig, demoClientConfig, demoSecretSetupStatus } from "./demo-config/fixtures-model";

export { demoConfigBootstrapScript } from "./demo-config/bootstrap-script";
