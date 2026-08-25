import type { QuarterTurn } from '../isometric/IsometricProjection.ts';

export const ROAD_NORTH = 1;
export const ROAD_EAST = 2;
export const ROAD_SOUTH = 4;
export const ROAD_WEST = 8;
export type RoadMask = number;
export type RoadLookup<T = string> = (x: number, y: number) => T | undefined;

export function roadConnectivityMask<T>(x: number, y: number, lookup: RoadLookup<T>): RoadMask {
  let mask = 0;
  if (lookup(x, y - 1) !== undefined) mask |= ROAD_NORTH;
  if (lookup(x + 1, y) !== undefined) mask |= ROAD_EAST;
  if (lookup(x, y + 1) !== undefined) mask |= ROAD_SOUTH;
  if (lookup(x - 1, y) !== undefined) mask |= ROAD_WEST;
  return mask;
}

export function rotateRoadMask(mask: RoadMask, turn: QuarterTurn): RoadMask {
  let result = mask & 0x0f;
  for (let i = 0; i < turn; i += 1) {
    const next = ((result & ROAD_NORTH) ? ROAD_EAST : 0)
      | ((result & ROAD_EAST) ? ROAD_SOUTH : 0)
      | ((result & ROAD_SOUTH) ? ROAD_WEST : 0)
      | ((result & ROAD_WEST) ? ROAD_NORTH : 0);
    result = next;
  }
  return result;
}
