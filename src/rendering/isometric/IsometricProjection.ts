export type QuarterTurn = 0 | 1 | 2 | 3;
export type IsoMetrics = Readonly<{ tileWidth: number; tileHeight: number }>;
export type WorldSize = Readonly<{ width: number; height: number }>;
export type Point = Readonly<{ x: number; y: number }>;

export const DEFAULT_ISO_METRICS: IsoMetrics = Object.freeze({ tileWidth: 64, tileHeight: 32 });

function normalizedTurn(turn: number): QuarterTurn {
  return (((turn % 4) + 4) % 4) as QuarterTurn;
}

export function rotatedWorldSize(size: WorldSize, turn: QuarterTurn): WorldSize {
  return turn % 2 === 0 ? size : { width: size.height, height: size.width };
}

export function rotateWorldPoint(x: number, y: number, size: WorldSize, turn: QuarterTurn): Point {
  switch (normalizedTurn(turn)) {
    case 1: return { x: size.height - 1 - y, y: x };
    case 2: return { x: size.width - 1 - x, y: size.height - 1 - y };
    case 3: return { x: y, y: size.width - 1 - x };
    default: return { x, y };
  }
}

export function inverseRotateWorldPoint(x: number, y: number, size: WorldSize, turn: QuarterTurn): Point {
  switch (normalizedTurn(turn)) {
    case 1: return { x: y, y: size.height - 1 - x };
    case 2: return { x: size.width - 1 - x, y: size.height - 1 - y };
    case 3: return { x: size.width - 1 - y, y: x };
    default: return { x, y };
  }
}

export function projectRotatedPoint(x: number, y: number, metrics: IsoMetrics = DEFAULT_ISO_METRICS): Point {
  return {
    x: (x - y) * metrics.tileWidth / 2,
    y: (x + y) * metrics.tileHeight / 2,
  };
}

export function inverseProjectPoint(x: number, y: number, metrics: IsoMetrics = DEFAULT_ISO_METRICS): Point {
  const a = x / (metrics.tileWidth / 2);
  const b = y / (metrics.tileHeight / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
}

export function diamondContains(localX: number, localY: number, metrics: IsoMetrics = DEFAULT_ISO_METRICS): boolean {
  return Math.abs(localX) / (metrics.tileWidth / 2) + Math.abs(localY) / (metrics.tileHeight / 2) <= 1 + 1e-9;
}
