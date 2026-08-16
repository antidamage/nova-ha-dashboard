import { describe, expect, it } from "vitest";
import { normalizeVoiceSettings, parseVoiceSettingsUpdate } from "./voice-settings";

/**
 * The two companion kill switches.
 *
 * Every other voice setting has a dashboard default. These two must be able to
 * say *nothing*, and that is the whole point of the tests below: a dashboard
 * that shipped `companionEnabled: true` would switch the feature on for any
 * deployment that had turned it off in configuration, the first time anyone
 * saved an unrelated voice setting.
 */
describe("companion kill switches", () => {
  it("says nothing when the stored settings say nothing", () => {
    const settings = normalizeVoiceSettings(null);

    expect(settings.companionEnabled).toBeUndefined();
    expect(settings.companionForceLocal).toBeUndefined();
  });

  it("carries an explicit choice through", () => {
    const settings = normalizeVoiceSettings({
      companionEnabled: false,
      companionForceLocal: true,
    });

    expect(settings.companionEnabled).toBe(false);
    expect(settings.companionForceLocal).toBe(true);
  });

  it("ignores a non-boolean rather than coercing it", () => {
    // "false" is truthy, and coercing it would turn an off switch on.
    const settings = normalizeVoiceSettings({
      companionEnabled: "false",
      companionForceLocal: 1,
    });

    expect(settings.companionEnabled).toBeUndefined();
    expect(settings.companionForceLocal).toBeUndefined();
  });

  it("keeps an explicit false distinct from absence", () => {
    // The voice server treats these differently: false means switch it off,
    // absent means leave it alone. Collapsing them would make it impossible to
    // turn the feature off from the dashboard at all.
    expect(normalizeVoiceSettings({ companionEnabled: false }).companionEnabled).toBe(false);
    expect(normalizeVoiceSettings({}).companionEnabled).toBeUndefined();
  });

  it("accepts both switches in an update", () => {
    const update = parseVoiceSettingsUpdate({
      companionEnabled: true,
      companionForceLocal: false,
    });

    expect(update.companionEnabled).toBe(true);
    expect(update.companionForceLocal).toBe(false);
  });

  it("omits a switch that is not being changed", () => {
    // A save of one control must not assert an opinion about the other.
    const update = parseVoiceSettingsUpdate({ companionForceLocal: true });

    expect(update.companionForceLocal).toBe(true);
    expect(update.companionEnabled).toBeUndefined();
  });
});
