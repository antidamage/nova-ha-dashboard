import type { DashboardConfig, SecretSetupStatus } from "./config-schema";

export const DEMO_CONFIG_STORAGE_KEY = "nova.dashboard.demoConfig.v1";
export const DEMO_THEME_STORAGE_KEY = "nova.dashboard.demoTheme.v1";
export const DEMO_THEME_LIBRARY_STORAGE_KEY = "nova.dashboard.demoThemeLibrary.v1";
export const DEMO_CONFIG_CHANGE_EVENT = "nova-demo-config-change";

export type DemoThemeEnvelope = {
  theme: Record<string, unknown> | null;
  updatedAt?: string | null;
};

export type DemoThemeLibrary = Record<string, unknown> | null;

export function demoClientConfig(config: DashboardConfig) {
  return {
    dashboard: {
      defaultZoneId: config.dashboard.defaultZoneId,
      aircon: config.dashboard.aircon,
      avatar: config.dashboard.avatar,
      bedroomHeater: config.dashboard.bedroomHeater,
      legacyPanelHeaterCardEnabled: config.dashboard.legacyPanelHeaterCardEnabled,
      lighting: config.dashboard.lighting,
      specialZones: config.dashboard.specialZones,
      timing: config.dashboard.timing,
    },
    mapWeather: config.mapWeather,
    theme: config.theme,
  };
}

export function demoSecretSetupStatus(config: DashboardConfig): SecretSetupStatus {
  return {
    homeAssistant: {
      urlConfigured: false,
      tokenConfigured: false,
    },
    iCloud: {
      usernameConfigured: false,
      appPasswordConfigured: false,
      enabled: false,
    },
    powershop: {
      emailConfigured: false,
      passwordConfigured: false,
      enabled: false,
    },
    mcp: {
      bearerTokenConfigured: false,
      authRequired: config.mcp.requireBearerAuth,
    },
  };
}

export function demoConfigBootstrapScript(
  defaultConfig: DashboardConfig,
  providerBase: string,
  defaultTheme: DemoThemeEnvelope = { theme: null, updatedAt: null },
  defaultThemeLibrary: DemoThemeLibrary = null,
) {
  const bootstrap = {
    changeEvent: DEMO_CONFIG_CHANGE_EVENT,
    defaultConfig,
    defaultTheme,
    defaultThemeLibrary,
    providerBase,
    storageKey: DEMO_CONFIG_STORAGE_KEY,
    themeStorageKey: DEMO_THEME_STORAGE_KEY,
    themeLibraryStorageKey: DEMO_THEME_LIBRARY_STORAGE_KEY,
  };

  return `
(function () {
  var bootstrap = ${JSON.stringify(bootstrap)};
  var DEFAULT_CONFIG = bootstrap.defaultConfig;
  var DEFAULT_THEME = bootstrap.defaultTheme;
  var DEFAULT_THEME_LIBRARY = bootstrap.defaultThemeLibrary;
  var nativeFetch = window.fetch.bind(window);
  var providerPromise = null;
  var memoryConfig = null;

  window.__NOVA_DEMO_MODE__ = true;
  window.__NOVA_DEMO_CONFIG_STORAGE_KEY__ = bootstrap.storageKey;

  function isRecord(value) {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
  }

  function clone(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function mergeDeep(base, override) {
    if (!isRecord(base) || !isRecord(override)) {
      return override === undefined ? clone(base) : clone(override);
    }
    var next = clone(base);
    Object.keys(override).forEach(function (key) {
      next[key] = key in next ? mergeDeep(next[key], override[key]) : clone(override[key]);
    });
    return next;
  }

  function storedText() {
    try {
      return window.sessionStorage.getItem(bootstrap.storageKey);
    } catch (_) {
      return memoryConfig ? JSON.stringify(memoryConfig) : null;
    }
  }

  function persistConfig(config) {
    memoryConfig = clone(config);
    try {
      window.sessionStorage.setItem(bootstrap.storageKey, JSON.stringify(config));
    } catch (_) {}
  }

  function readDemoConfig() {
    var raw = storedText();
    if (!raw) {
      var seeded = clone(DEFAULT_CONFIG);
      persistConfig(seeded);
      return seeded;
    }

    try {
      var stored = JSON.parse(raw);
      if (!isRecord(stored) || stored.schemaVersion !== DEFAULT_CONFIG.schemaVersion) {
        throw new Error("Stored demo config schema does not match defaults.");
      }
      var merged = mergeDeep(DEFAULT_CONFIG, stored);
      persistConfig(merged);
      return merged;
    } catch (_) {
      var reset = clone(DEFAULT_CONFIG);
      persistConfig(reset);
      return reset;
    }
  }

  function persistTheme(envelope) {
    try {
      window.sessionStorage.setItem(bootstrap.themeStorageKey, JSON.stringify(envelope));
    } catch (_) {}
  }

  function readDemoTheme() {
    var raw = null;
    try {
      raw = window.sessionStorage.getItem(bootstrap.themeStorageKey);
    } catch (_) {}

    if (raw) {
      try {
        var stored = JSON.parse(raw);
        if (isRecord(stored)) {
          return stored;
        }
      } catch (_) {}
    }

    var seeded = clone(DEFAULT_THEME);
    persistTheme(seeded);
    return seeded;
  }

  function readThemeResponse() {
    return jsonResponse(readDemoTheme());
  }

  function writeThemeResponse(input, init) {
    return requestBodyText(input, init).then(function (text) {
      var current = readDemoTheme();
      var body = text ? JSON.parse(text) : {};
      var settingOnly = isRecord(body)
        && typeof body.followVisualizerWhenActive === "boolean"
        && body.theme === undefined;
      var nextTheme = settingOnly ? null : isRecord(body) && body.theme !== undefined ? body.theme : body;
      var baseTheme = isRecord(current.theme) ? current.theme : {};
      var combinedTheme = clone(baseTheme);
      if (isRecord(nextTheme)) {
        Object.keys(nextTheme).forEach(function (key) {
          combinedTheme[key] = clone(nextTheme[key]);
        });
      }
      var merged = {
        followVisualizerWhenActive: isRecord(body) && typeof body.followVisualizerWhenActive === "boolean"
          ? body.followVisualizerWhenActive
          : current.followVisualizerWhenActive === true,
        theme: combinedTheme,
        updatedAt: new Date().toISOString(),
      };
      persistTheme(merged);
      return jsonResponse(merged);
    });
  }

  function persistThemeLibrary(envelope) {
    try {
      window.sessionStorage.setItem(bootstrap.themeLibraryStorageKey, JSON.stringify(envelope));
    } catch (_) {}
  }

  function emptyLibrary() {
    return { version: 1, activeId: null, entries: [] };
  }

  function readDemoThemeLibrary() {
    var raw = null;
    try {
      raw = window.sessionStorage.getItem(bootstrap.themeLibraryStorageKey);
    } catch (_) {}

    if (raw) {
      try {
        var stored = JSON.parse(raw);
        if (isRecord(stored) && isRecord(stored.library)) {
          return stored;
        }
      } catch (_) {}
    }

    var seeded = {
      library: isRecord(DEFAULT_THEME_LIBRARY) ? clone(DEFAULT_THEME_LIBRARY) : emptyLibrary(),
      updatedAt: null,
    };
    persistThemeLibrary(seeded);
    return seeded;
  }

  function readThemeLibraryResponse() {
    return jsonResponse(readDemoThemeLibrary());
  }

  function writeThemeLibraryResponse(input, init) {
    return requestBodyText(input, init).then(function (text) {
      var body = text ? JSON.parse(text) : {};
      var nextLibrary = isRecord(body) && isRecord(body.library) ? body.library : emptyLibrary();
      var merged = {
        library: clone(nextLibrary),
        updatedAt: new Date().toISOString(),
      };
      persistThemeLibrary(merged);
      return jsonResponse(merged);
    });
  }

  function clientConfig(config) {
    var dashboard = config.dashboard || {};
    return {
      dashboard: {
        defaultZoneId: dashboard.defaultZoneId,
        aircon: dashboard.aircon,
        avatar: dashboard.avatar,
        bedroomHeater: dashboard.bedroomHeater,
        legacyPanelHeaterCardEnabled: dashboard.legacyPanelHeaterCardEnabled,
        lighting: dashboard.lighting,
        specialZones: dashboard.specialZones,
        timing: dashboard.timing,
      },
      mapWeather: config.mapWeather,
      theme: config.theme,
    };
  }

  function secretSetupStatus(config) {
    var mcp = config.mcp || {};
    return {
      homeAssistant: {
        urlConfigured: false,
        tokenConfigured: false,
      },
      iCloud: {
        usernameConfigured: false,
        appPasswordConfigured: false,
        enabled: false,
      },
      powershop: {
        emailConfigured: false,
        passwordConfigured: false,
        enabled: false,
      },
      mcp: {
        bearerTokenConfigured: false,
        authRequired: mcp.requireBearerAuth === true,
      },
    };
  }

  function jsonResponse(value, status) {
    return Promise.resolve(new Response(JSON.stringify(value), {
      status: status || 200,
      headers: {
        "Content-Type": "application/json",
        "X-Nova-Demo-Config": "session-storage",
      },
    }));
  }

  function requestMethod(input, init) {
    return String((init && init.method) || (input && input.method) || "GET").toUpperCase();
  }

  function requestBodyText(input, init) {
    if (init && init.body !== undefined) {
      var body = init.body;
      if (typeof body === "string") return Promise.resolve(body);
      if (body && typeof body.text === "function") return body.text();
      return Promise.resolve(String(body || ""));
    }
    if (input && typeof input !== "string" && typeof input.clone === "function") {
      return input.clone().text();
    }
    return Promise.resolve("");
  }

  function configFromBodyText(text) {
    var body = text ? JSON.parse(text) : {};
    var candidate = isRecord(body) && body.config !== undefined ? body.config : body;
    if (!isRecord(candidate)) {
      throw new Error("Demo config payload must be an object.");
    }
    return mergeDeep(DEFAULT_CONFIG, candidate);
  }

  function configResult(config, applied) {
    return {
      ok: true,
      config: config,
      errors: [],
      applied: applied,
    };
  }

  function invalidConfigResult(error) {
    return {
      ok: false,
      errors: [{
        code: "invalid_demo_config",
        message: error && error.message ? error.message : "Demo config payload is invalid.",
        path: "$",
      }],
      applied: false,
    };
  }

  function readConfigResponse() {
    var config = readDemoConfig();
    return jsonResponse({
      config: config,
      secrets: secretSetupStatus(config),
    });
  }

  function writeConfigResponse(input, init) {
    return requestBodyText(input, init).then(function (text) {
      try {
        var config = configFromBodyText(text);
        persistConfig(config);
        window.dispatchEvent(new CustomEvent(bootstrap.changeEvent, { detail: config }));
        return jsonResponse(configResult(config, true));
      } catch (error) {
        return jsonResponse(invalidConfigResult(error), 400);
      }
    });
  }

  function validateConfigResponse(input, init) {
    return requestBodyText(input, init).then(function (text) {
      try {
        return jsonResponse(configResult(configFromBodyText(text), false));
      } catch (error) {
        return jsonResponse(invalidConfigResult(error), 400);
      }
    });
  }

  function handleDemoConfigRequest(pathname, input, init) {
    var method = requestMethod(input, init);
    if (pathname === "/api/config/client" && method === "GET") {
      return jsonResponse(clientConfig(readDemoConfig()));
    }
    if (pathname === "/api/config" && method === "GET") {
      return readConfigResponse();
    }
    if (pathname === "/api/config" && method === "PUT") {
      return writeConfigResponse(input, init);
    }
    if (pathname === "/api/config/validate" && method === "POST") {
      return validateConfigResponse(input, init);
    }
    if (pathname === "/api/theme" && method === "GET") {
      return readThemeResponse();
    }
    if (pathname === "/api/theme" && method === "POST") {
      return writeThemeResponse(input, init);
    }
    if (pathname === "/api/theme-library" && method === "GET") {
      return readThemeLibraryResponse();
    }
    if (pathname === "/api/theme-library" && method === "POST") {
      return writeThemeLibraryResponse(input, init);
    }
    return null;
  }

  function shouldHandle(input) {
    var url = typeof input === "string" ? input : (input && input.url ? input.url : "");
    if (!url) return false;
    try {
      var parsed = new URL(url, window.location.href);
      return parsed.origin === window.location.origin && parsed.pathname.indexOf("/api/") === 0;
    } catch (_) {
      return url.indexOf("/api/") === 0;
    }
  }

  function loadProvider() {
    if (!providerPromise) {
      providerPromise = import(new URL("provider.mjs", bootstrap.providerBase).href)
        .then(function (module) {
          return module.createNovaDummyProvider({ baseUrl: bootstrap.providerBase });
        });
    }
    return providerPromise;
  }

  readDemoConfig();
  readDemoTheme();
  readDemoThemeLibrary();

  window.fetch = function (input, init) {
    if (!shouldHandle(input)) return nativeFetch(input, init);
    var path = typeof input === "string" ? input : input.url;
    var parsed = new URL(path, window.location.href);
    var configResponse = handleDemoConfigRequest(parsed.pathname, input, init);
    if (configResponse) return configResponse;
    return loadProvider().then(function (provider) {
      return provider.handleRequest(parsed.pathname + parsed.search, init || input);
    });
  };

  var DemoEventSource = function () {
    this.readyState = 1;
    this.listeners = {};
    var self = this;
    setTimeout(function () {
      self.dispatchEvent({ type: "open" });
      self.dispatchEvent({ type: "client-id", data: JSON.stringify({ id: 1 }) });
    }, 0);
  };
  DemoEventSource.prototype.addEventListener = function (type, listener) {
    this.listeners[type] = this.listeners[type] || [];
    this.listeners[type].push(listener);
  };
  DemoEventSource.prototype.removeEventListener = function (type, listener) {
    this.listeners[type] = (this.listeners[type] || []).filter(function (candidate) { return candidate !== listener; });
  };
  DemoEventSource.prototype.dispatchEvent = function (event) {
    (this.listeners[event.type] || []).forEach(function (listener) { listener(event); });
  };
  DemoEventSource.prototype.close = function () {
    this.readyState = 2;
    this.listeners = {};
  };
  window.EventSource = DemoEventSource;
})()
`;
}
