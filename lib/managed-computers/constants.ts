// Command timeout bounds and the on-disk locations of the store and SSH keys.
import path from "path";

export const DEFAULT_COMMAND_TIMEOUT_MS = 15_000;
export const MIN_COMMAND_TIMEOUT_MS = 1_000;
export const MAX_COMMAND_TIMEOUT_MS = 120_000;
export const STORE_PATH =
  process.env.NOVA_MANAGED_COMPUTERS_PATH ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "managed-computers.json");
export const KEY_DIR =
  process.env.NOVA_MANAGED_COMPUTER_KEY_DIR ??
  path.join(/*turbopackIgnore: true*/ process.cwd(), "data", "managed-computer-keys");
