export type BrowserSatelliteHello = {
  satelliteId: string;
  displayName: string;
  roomId: string;
  capturePolicy: "always" | "push-to-talk";
};

export type BrowserSatelliteCallbacks = {
  onHelloAck?: () => void;
  onPlaybackStart?: () => void;
  onPlaybackDone?: () => void;
  onClose?: (reason: string) => void;
  onError?: (error: unknown) => void;
  onStateChange?: (state: BrowserSatelliteState) => void;
};

export type BrowserSatelliteState =
  | "starting"
  | "connecting"
  | "connected"
  | "recovering"
  | "stopped";
