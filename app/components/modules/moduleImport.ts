/**
 * The runtime import of a module's client bundle, kept in its own file for one
 * reason: it is the only part of `ModuleHost` that cannot run under a test
 * runner, so isolating it lets everything else — the registration API, the slot
 * table, the confirm flow — be tested for real.
 *
 * `webpackIgnore` stops Turbopack resolving the specifier at build time; the
 * `?v=` token is the module's clientVersion, so a reinstalled module is fetched
 * fresh rather than served from cache (`specs/module-system.md` §2).
 */
export type LoadedModuleClient = {
  default?: { register?: (api: unknown) => unknown };
};

export async function importModuleClient(id: string, version: string): Promise<LoadedModuleClient> {
  return (await import(
    /* webpackIgnore: true */ `/api/modules/${id}/client.mjs?v=${version}`
  )) as LoadedModuleClient;
}
