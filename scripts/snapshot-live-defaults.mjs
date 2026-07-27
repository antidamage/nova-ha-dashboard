import { writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const sourceUrl = new URL(process.argv[2] ?? "http://nova.local");
const defaultThemeName = process.argv[3] ?? "Human Revolution";
const root = process.cwd();
const publicTextureUrl = "/nova-background-texture.png";

async function get(route) {
  const url = new URL(route, sourceUrl);
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) {
    throw new Error(`GET ${url} failed: HTTP ${response.status}`);
  }
  return response.json();
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function withoutKeys(value, keys) {
  const next = clone(value ?? {});
  for (const key of keys) delete next[key];
  return next;
}

function sanitizeThemeVariant(variant) {
  if (!variant || typeof variant !== "object") return;
  if (variant.backgroundEffect && typeof variant.backgroundEffect === "object") {
    variant.backgroundEffect.textureUrl = publicTextureUrl;
  }
  delete variant.desktopWallpaper;
}

function sanitizeThemeSet(themeSet) {
  const next = clone(themeSet);
  sanitizeThemeVariant(next?.themes?.dark);
  sanitizeThemeVariant(next?.themes?.light);
  return next;
}

async function writeJson(relativePath, value) {
  await writeFile(path.join(root, relativePath), `${JSON.stringify(value, null, 2)}\n`);
  console.log(`wrote ${relativePath}`);
}

const [
  configEnvelope,
  themeEnvelope,
  themeLibraryEnvelope,
  voiceEnvelope,
  state,
  watchfaceEnvelope,
  layoutEnvelope,
  personalityLibraryEnvelope,
  updateEnvelope,
] = await Promise.all([
  get("/api/config"),
  get("/api/theme"),
  get("/api/theme-library"),
  get("/api/voice"),
  get("/api/state"),
  get("/api/watchface"),
  get("/api/layout"),
  get("/api/voice-personality-library"),
  get("/api/update"),
]);

const themeLibrary = clone(themeLibraryEnvelope.library);
for (const entry of themeLibrary.entries ?? []) {
  entry.themeSet = sanitizeThemeSet(entry.themeSet);
}
const defaultThemeEntry = themeLibrary.entries?.find((entry) => entry.name === defaultThemeName);
if (!defaultThemeEntry) {
  throw new Error(`Theme library does not contain ${JSON.stringify(defaultThemeName)}`);
}
themeLibrary.activeId = defaultThemeEntry.id;

const layout = clone(themeEnvelope.layout ?? layoutEnvelope.layout ?? {});
const defaultThemeEnvelope = {
  theme: sanitizeThemeSet(defaultThemeEntry.themeSet),
  layout,
  updatedAt: null,
};

const config = clone(configEnvelope.config);
if (!config?.dashboard?.camera?.outside) {
  throw new Error("Portable config did not include dashboard.camera.outside");
}
// The portable API is secret-free, but capture host names and ownership still
// describe one installation. Preserve visual tuning while making the shipped
// default usable on a different host.
delete config.dashboard.camera.outside.videoHostUrl;
delete config.dashboard.camera.outside.ingestionEnabled;
config.dashboard.avatar = clone(defaultThemeEnvelope.theme.themes.dark.avatar);
for (const key of ["innerShadowOpacity", "orbModule", "orbModuleSettings", "glass", "voiceGlowColor"]) {
  delete config.dashboard.avatar[key];
}

const common = {
  homeAssistant: {
    weatherEntityId: config.homeAssistant.weatherEntityId,
    sunEntityId: config.homeAssistant.sunEntityId,
    router: clone(config.homeAssistant.router),
    novaAssistSatelliteEntityId: config.homeAssistant.novaAssistSatelliteEntityId,
    climateAreaNames: clone(config.homeAssistant.climateAreaNames),
    networkZoneId: config.homeAssistant.networkZoneId,
    everythingExcludedEntityIds: clone(config.homeAssistant.everythingExcludedEntityIds),
    classification: clone(config.homeAssistant.classification),
  },
  dashboard: {
    defaultZoneId: config.dashboard.defaultZoneId,
    specialZones: clone(config.dashboard.specialZones),
  },
  mapWeather: {
    center: clone(config.mapWeather.center),
  },
  power: {
    timeZone: config.power.timeZone,
    billing: clone(config.power.billing),
  },
};

const tasks = { tasks: clone(config.tasks) };
const statePreferences = state.preferences ?? {};
const defaultPreferences = {
  agent: withoutKeys(voiceEnvelope.agent, ["updatedAt"]),
  aircon: withoutKeys(statePreferences.aircon, ["offTimerEndsAt", "updatedAt"]),
  lighting: withoutKeys(statePreferences.lighting, ["updatedAt"]),
  watchface: withoutKeys(watchfaceEnvelope.watchface, [
    "daysSinceGym",
    "gymLastResetAt",
    "updatedAt",
  ]),
  voice: withoutKeys(voiceEnvelope.voice, ["updatedAt"]),
  voicePersonalityLibrary: clone(personalityLibraryEnvelope.library),
  update: { autoUpdate: updateEnvelope.autoUpdate === true },
  layout,
};
const panelHeater = withoutKeys(statePreferences.panelHeater, ["offTimerEndsAt", "updatedAt"]);
if (Object.keys(panelHeater).length) defaultPreferences.panelHeater = panelHeater;

await Promise.all([
  writeJson("config/dashboard-config.default.json", config),
  writeJson("config/common.json", common),
  writeJson("config/tasks.json", tasks),
  writeJson("config/demo-theme.default.json", defaultThemeEnvelope),
  writeJson("config/demo-theme-library.default.json", themeLibrary),
  writeJson("config/dashboard-preferences.default.json", defaultPreferences),
]);

console.log(`default theme: ${defaultThemeEntry.name} (${defaultThemeEntry.id})`);
