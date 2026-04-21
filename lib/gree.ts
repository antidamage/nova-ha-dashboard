import { createRequire } from "module";

const require = createRequire(import.meta.url);
const GREE_AIRCON_HOST = process.env.GREE_AIRCON_HOST;

type GreeClient = {
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  setProperties: (properties: Record<string, string | number>) => Promise<void>;
};

type GreeModule = {
  Client: new (options: Record<string, unknown>) => GreeClient;
  PROPERTY: Record<string, string>;
  VALUE: {
    swingHor: Record<string, string>;
    swingVert: Record<string, string>;
  };
};

const Gree = require("gree-hvac-client") as GreeModule;

export async function setGreeAirconSweep(enabled: boolean) {
  const client = new Gree.Client({
    host: GREE_AIRCON_HOST,
    autoConnect: false,
    poll: false,
    connectTimeout: 2500,
    pollingTimeout: 800,
    logLevel: "error",
  });

  try {
    await client.connect();
    await client.setProperties({
      [Gree.PROPERTY.swingHor]: enabled ? Gree.VALUE.swingHor.full : Gree.VALUE.swingHor.fixedMid,
      [Gree.PROPERTY.swingVert]: enabled ? Gree.VALUE.swingVert.full : Gree.VALUE.swingVert.fixedTop,
    });
  } finally {
    await client.disconnect().catch(() => undefined);
  }
}
