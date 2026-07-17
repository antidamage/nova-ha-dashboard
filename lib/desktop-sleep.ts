import { sleepManagedComputer } from "./managed-computers";

export async function sleepDesktop(id: string) {
  return sleepManagedComputer(id);
}
