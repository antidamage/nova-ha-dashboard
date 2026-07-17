type LightingCommandStore = {
  latestByKey: Map<string, number>;
  nextSequence: number;
};

const globalWithLightingCommands = globalThis as typeof globalThis & {
  __novaLightingCommands?: LightingCommandStore;
};

const store =
  globalWithLightingCommands.__novaLightingCommands ??
  (globalWithLightingCommands.__novaLightingCommands = {
    latestByKey: new Map<string, number>(),
    nextSequence: 0,
  });

export const INTERACTIVE_LIGHTING_COMMAND_KEY = "lighting:interactive";

export class SupersededLightingCommandError extends Error {
  constructor(message = "Lighting command superseded") {
    super(message);
    this.name = "SupersededLightingCommandError";
  }
}

export function isSupersededLightingCommandError(error: unknown) {
  return error instanceof SupersededLightingCommandError;
}

function normalizedKeys(keys: string | string[]) {
  return (Array.isArray(keys) ? keys : [keys]).map((key) => key.trim()).filter(Boolean);
}

export function claimLatestLightingCommand(keys: string | string[], signal?: AbortSignal) {
  const commandKeys = normalizedKeys(keys);
  const sequence = store.nextSequence + 1;
  store.nextSequence = sequence;

  for (const key of commandKeys) {
    store.latestByKey.set(key, sequence);
  }

  return {
    assertCurrent() {
      if (signal?.aborted || commandKeys.some((key) => store.latestByKey.get(key) !== sequence)) {
        throw new SupersededLightingCommandError();
      }
    },
    isCurrent() {
      return !signal?.aborted && commandKeys.every((key) => store.latestByKey.get(key) === sequence);
    },
    keys: commandKeys,
    sequence,
  };
}

export type LatestLightingCommandClaim = ReturnType<typeof claimLatestLightingCommand>;

export function resetLightingCommandCoordinatorForTest() {
  store.latestByKey.clear();
  store.nextSequence = 0;
}
