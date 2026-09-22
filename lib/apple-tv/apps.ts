/**
 * The two apps this feature drives on the Apple TV, by bundle id (Adeline,
 * 2026-09-22).
 *
 * Bundle ids rather than the names in the app list: "Music" is what this house's
 * set happens to call Apple's app, and a television set to another language
 * calls it something else, while `com.apple.TVMusic` is the bundle either way.
 *
 * Both are product constants like `com.apple.TVMusic` — not household facts —
 * which is why they live here rather than in config. The *device* is the
 * household's, and it comes from `power.ampPowerControl.sourceEntityId`.
 */

/** Apple's Music app: what plays the playlist, and what should be on screen. */
export const MUSIC_APP = "com.apple.TVMusic";

/**
 * Nova's own app on the television (`nova-appletv-dashboard`) — the only place
 * in this house with a MusicKit session, so the one thing that can turn a
 * preset's *name* into a playlist.
 */
export const NOVA_TV_APP = "nz.co.skull.NovaAppleTVDashboard";
