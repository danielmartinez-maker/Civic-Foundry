export const HYDROLOGY_EPSILON = 1e-9;
export const D8_CLOCKWISE: readonly (readonly [number, number])[] = Object.freeze([
  Object.freeze([0, -1] as const),
  Object.freeze([1, -1] as const),
  Object.freeze([1, 0] as const),
  Object.freeze([1, 1] as const),
  Object.freeze([0, 1] as const),
  Object.freeze([-1, 1] as const),
  Object.freeze([-1, 0] as const),
  Object.freeze([-1, -1] as const),
]);
