export type RadarTileParams = {
  x: string;
  y: string;
  z: string;
};

export type RadarManifest = {
  host?: string;
  radar?: {
    past?: Array<{
      path?: string;
      time?: number;
    }>;
  };
};

export type RadarFrame = {
  host: string;
  path: string;
};
