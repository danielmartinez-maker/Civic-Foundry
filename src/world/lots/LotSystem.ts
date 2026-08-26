import type { ZoneType } from '../../simulation/core/types.ts';
import type { RoadSystem } from '../roads/RoadSystem.ts';
import type { ZoningSystem } from '../../simulation/zoning/ZoningSystem.ts';

export type Lot = Readonly<{
  id: string;
  x: number;
  y: number;
  zone: ZoneType;
  frontageRoadKey: string;
}>;

const CARDINAL = [[0,-1],[1,0],[0,1],[-1,0]] as const;

export class LotSystem {
  private lots: Lot[] = [];
  private _entityRevision = 0;

  get entityRevision(): number {
    return this._entityRevision;
  }

  rebuild(roads: RoadSystem, zoning: ZoningSystem): void {
    const next: Lot[] = [];
    for (const cell of zoning.list()) {
      let frontage: string | undefined;
      for (const [dx, dy] of CARDINAL) {
        const road = roads.get(cell.x + dx, cell.y + dy);
        if (road) {
          frontage = `${road.x},${road.y}`;
          break;
        }
      }
      if (frontage) next.push({ id: `lot:${cell.x},${cell.y}`, x: cell.x, y: cell.y, zone: cell.zone, frontageRoadKey: frontage });
    }
    this.lots = next.sort((a, b) => a.y - b.y || a.x - b.x);
    this._entityRevision++;
  }

  list(): Lot[] {
    return this.lots.map((lot) => ({ ...lot }));
  }
}