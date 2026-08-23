export type SpeedMode = 0 | 1 | 2 | 4;
export type CellCoord = Readonly<{ x: number; y: number }>;
export type ZoneType = 'residential' | 'commercial' | 'industrial';

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function clamp01(value: number): number {
  return clamp(value, 0, 1);
}
