import type { ModuleManifest } from "../manifest";
import type { ModuleStatusReport } from "../types";

export type ModuleRouteHandler = (request: {
  method: string;
  pathSegments: string[];
  query: Record<string, string>;
  headers: Record<string, string>;
  body: unknown;
}) => Promise<{ status?: number; body?: unknown }> | { status?: number; body?: unknown };

export type LoadedModule = {
  id: string;
  manifest: ModuleManifest;
  instance: { register?: (api: unknown) => unknown; dispose?: () => unknown } | null;
  routes: Map<string, ModuleRouteHandler>;
  status?: ModuleStatusReport;
  configListeners: ((config: Record<string, unknown>) => void)[];
};

export type LoaderStore = {
  loaded: Map<string, LoadedModule>;
  starting: Promise<void> | null;
};
