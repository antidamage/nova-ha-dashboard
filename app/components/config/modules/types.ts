// Shared shapes for the Modules configuration tab. Zero runtime.
import type { ModuleConfigSchema } from "../../../../lib/modules/runtime/manifest";

export type ConfigResponse = {
  config: Record<string, unknown>;
  schema: ModuleConfigSchema;
  messages: Record<string, string>;
};
