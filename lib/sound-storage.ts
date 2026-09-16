import path from "path";

// Server-side paths for uploaded UX sounds. Kept out of lib/sound-library.ts
// because that module is imported by client components, and out of the route
// files because a Next route module may only export its HTTP handlers.
// See specs/ux-sounds.md.

export function soundsDirectory() {
  return process.env.NOVA_DASHBOARD_SOUNDS ?? path.join(process.cwd(), "data", "sounds");
}

export function uploadedSoundPath(id: string) {
  return path.join(soundsDirectory(), `${id}.mp3`);
}
