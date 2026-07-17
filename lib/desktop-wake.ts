import { wakeManagedComputer } from "./managed-computers";

export async function wakeDesktop(id: string) {
  return wakeManagedComputer(id);
}
