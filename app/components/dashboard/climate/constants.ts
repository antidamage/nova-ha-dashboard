// How long after the last temperature tap we wait before sending the final
// set_temperature to the air conditioner. Only the last value is ever sent.
export const AIRCON_TEMPERATURE_SEND_DEBOUNCE_MS = 2000;

/**
 * How long after the last mode tap the mode is actually sent.
 *
 * The temperature knob cycles its mode lights on a tap, so Auto to Off passes
 * through Manual. Sending each one as it is tapped would switch the air
 * conditioner on for a moment on the way past (Adeline, 2026-09-12:
 * specs/temperature-encoder.md). The light moves at once; only the mode the
 * taps settle on is commanded.
 */
export const CLIMATE_MODE_COMMIT_DEBOUNCE_MS = 1500;
