export const GEOMETRY_EPSILON = 1e-9;

export function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) <= GEOMETRY_EPSILON;
}

export function pointsNearlyEqual(a: Readonly<{ x: number; y: number }>, b: Readonly<{ x: number; y: number }>): boolean {
  return nearlyEqual(a.x, b.x) && nearlyEqual(a.y, b.y);
}
