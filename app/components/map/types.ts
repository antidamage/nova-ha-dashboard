export type DragRotateResultShim = {
  bearingDelta?: number;
} & Record<string, unknown>;

export type MutableRasterTileSource = {
  setTiles: (tiles: string[]) => void;
};

export type MouseRotateHandlerShim = {
  _moveFunction?: (lastPoint: unknown, currentPoint: unknown) => DragRotateResultShim | undefined;
};

export type DragRotateHandlerShim = {
  _mouseRotate?: MouseRotateHandlerShim;
};
