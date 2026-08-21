import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';
import type { TreasurySystem } from '../treasury/TreasurySystem.ts';
import {
  TRANSIT_LIMITS,
  TRANSIT_MODE_DEFINITIONS,
  TRANSIT_STOP_DEFINITIONS,
  type TransitMode,
  type TransitStopType,
} from '../../data/transit.ts';

export type TransitStop = Readonly<{
  id: string;
  type: TransitStopType;
  x: number;
  y: number;
}>;

export type TransitLine = Readonly<{
  id: string;
  name: string;
  mode: TransitMode;
  stopIds: readonly string[];
  headwayTicks: number;
  fare: number;
  enabled: boolean;
}>;

export type TransitNetworkSnapshot = Readonly<{
  revision: number;
  nextStopId: number;
  nextLineId: number;
  stops: readonly TransitStop[];
  lines: readonly TransitLine[];
}>;

export type TransitStopPlacementResult = Readonly<{ ok: boolean; cost: number; id?: string; reason?: string }>;
export type TransitTopologyResult = Readonly<{ ok: boolean; reason?: string }>;

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, Number.isFinite(value) ? value : min));

export class TransitNetworkSystem {
  private readonly terrain: TerrainGrid;
  private readonly roads: RoadSystem;
  private readonly externallyOccupied: (x: number, y: number) => boolean;
  private readonly stops = new Map<string, TransitStop>();
  private readonly lines = new Map<string, TransitLine>();
  private nextStopId = 1;
  private nextLineId = 1;
  revision = 0;

  constructor(terrain: TerrainGrid, roads: RoadSystem, externallyOccupied: (x: number, y: number) => boolean = () => false) {
    this.terrain = terrain;
    this.roads = roads;
    this.externallyOccupied = externallyOccupied;
  }

  placeStop(type: TransitStopType, x: number, y: number, treasury: TreasurySystem): TransitStopPlacementResult {
    const definition = TRANSIT_STOP_DEFINITIONS[type];
    const cost = definition.constructionCost;
    if (!this.terrain.isBuildable(x, y)) return { ok: false, cost, reason: 'unbuildable terrain' };
    if (this.roads.has(x, y)) return { ok: false, cost, reason: 'road occupies cell' };
    if (this.externallyOccupied(x, y) || this.getStopAt(x, y)) return { ok: false, cost, reason: 'cell occupied' };
    if (!CARDINAL.some(([dx, dy]) => this.roads.has(x + dx, y + dy))) return { ok: false, cost, reason: 'road access required' };
    if (!treasury.tryDebit(cost, `Build ${definition.label}`)) return { ok: false, cost, reason: 'insufficient funds' };
    const id = `transit-stop:${this.nextStopId++}`;
    this.stops.set(id, Object.freeze({ id, type, x, y }));
    this.revision++;
    return { ok: true, cost, id };
  }

  removeStop(id: string): boolean {
    if (!this.stops.delete(id)) return false;
    for (const [lineId, line] of this.lines.entries()) {
      if (!line.stopIds.includes(id)) continue;
      const stopIds = line.stopIds.filter((stopId) => stopId !== id);
      this.lines.set(lineId, Object.freeze({ ...line, stopIds: Object.freeze(stopIds), enabled: line.enabled && stopIds.length >= 2 }));
    }
    this.revision++;
    return true;
  }

  createLine(mode: TransitMode, name = ''): string {
    const definition = TRANSIT_MODE_DEFINITIONS[mode];
    const id = `transit-line:${this.nextLineId++}`;
    const safeName = name.trim() || `${definition.label} ${id.split(':')[1]}`;
    this.lines.set(id, Object.freeze({
      id,
      name: safeName,
      mode,
      stopIds: Object.freeze([]),
      headwayTicks: definition.defaultHeadwayTicks,
      fare: definition.defaultFare,
      enabled: false,
    }));
    this.revision++;
    return id;
  }

  setLineStops(lineId: string, stopIds: readonly string[]): TransitTopologyResult {
    const line = this.lines.get(lineId);
    if (!line) return { ok: false, reason: 'unknown line' };
    if (stopIds.length < 2) return { ok: false, reason: 'line requires at least two stops' };
    if (new Set(stopIds).size !== stopIds.length) return { ok: false, reason: 'duplicate stop in line' };
    const requiredType = TRANSIT_MODE_DEFINITIONS[line.mode].stopType;
    for (const stopId of stopIds) {
      const stop = this.stops.get(stopId);
      if (!stop) return { ok: false, reason: `unknown stop: ${stopId}` };
      if (stop.type !== requiredType) return { ok: false, reason: `incompatible stop type for ${line.mode}` };
    }
    const normalized = [...stopIds];
    const unchanged = line.stopIds.length === normalized.length && line.stopIds.every((id, index) => id === normalized[index]);
    if (unchanged) return { ok: true };
    this.lines.set(lineId, Object.freeze({ ...line, stopIds: Object.freeze(normalized) }));
    this.revision++;
    return { ok: true };
  }

  setHeadway(lineId: string, ticks: number): number {
    const line = this.requireLine(lineId);
    const value = Math.round(clamp(ticks, TRANSIT_LIMITS.minHeadwayTicks, TRANSIT_LIMITS.maxHeadwayTicks));
    if (line.headwayTicks !== value) {
      this.lines.set(lineId, Object.freeze({ ...line, headwayTicks: value }));
      this.revision++;
    }
    return value;
  }

  setFare(lineId: string, fare: number): number {
    const line = this.requireLine(lineId);
    const value = Math.round(clamp(fare, TRANSIT_LIMITS.minFare, TRANSIT_LIMITS.maxFare) * 100) / 100;
    if (line.fare !== value) {
      this.lines.set(lineId, Object.freeze({ ...line, fare: value }));
      this.revision++;
    }
    return value;
  }

  setEnabled(lineId: string, enabled: boolean): boolean {
    const line = this.requireLine(lineId);
    const value = Boolean(enabled) && line.stopIds.length >= 2;
    if (line.enabled !== value) {
      this.lines.set(lineId, Object.freeze({ ...line, enabled: value }));
      this.revision++;
    }
    return value;
  }

  getStop(id: string): TransitStop | undefined {
    const stop = this.stops.get(id);
    return stop ? { ...stop } : undefined;
  }

  getStopAt(x: number, y: number): TransitStop | undefined {
    for (const stop of this.stops.values()) if (stop.x === x && stop.y === y) return { ...stop };
    return undefined;
  }

  listStops(): TransitStop[] {
    return [...this.stops.values()].map((stop) => ({ ...stop })).sort((a, b) => a.id.localeCompare(b.id));
  }

  getLine(id: string): TransitLine | undefined {
    const line = this.lines.get(id);
    return line ? { ...line, stopIds: [...line.stopIds] } : undefined;
  }

  listLines(): TransitLine[] {
    return [...this.lines.values()].map((line) => ({ ...line, stopIds: [...line.stopIds] })).sort((a, b) => a.id.localeCompare(b.id));
  }

  snapshot(): TransitNetworkSnapshot {
    return Object.freeze({
      revision: this.revision,
      nextStopId: this.nextStopId,
      nextLineId: this.nextLineId,
      stops: Object.freeze(this.listStops().map((stop) => Object.freeze({ ...stop }))),
      lines: Object.freeze(this.listLines().map((line) => Object.freeze({ ...line, stopIds: Object.freeze([...line.stopIds]) }))),
    });
  }

  restore(snapshot: TransitNetworkSnapshot): void {
    this.stops.clear();
    this.lines.clear();
    for (const stop of snapshot.stops.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      if (!this.terrain.isBuildable(stop.x, stop.y) || this.roads.has(stop.x, stop.y)) throw new Error('invalid restored transit stop');
      if (!CARDINAL.some(([dx, dy]) => this.roads.has(stop.x + dx, stop.y + dy))) throw new Error('restored transit stop lacks road access');
      if (this.getStopAt(stop.x, stop.y)) throw new Error('duplicate restored transit stop cell');
      this.stops.set(stop.id, Object.freeze({ ...stop }));
    }
    for (const line of snapshot.lines.slice().sort((a, b) => a.id.localeCompare(b.id))) {
      const requiredType = TRANSIT_MODE_DEFINITIONS[line.mode]?.stopType;
      if (!requiredType) throw new Error('invalid restored transit mode');
      if (new Set(line.stopIds).size !== line.stopIds.length) throw new Error('duplicate restored line stop');
      for (const stopId of line.stopIds) {
        const stop = this.stops.get(stopId);
        if (!stop || stop.type !== requiredType) throw new Error('invalid restored line stop reference');
      }
      this.lines.set(line.id, Object.freeze({
        ...line,
        stopIds: Object.freeze([...line.stopIds]),
        headwayTicks: Math.round(clamp(line.headwayTicks, TRANSIT_LIMITS.minHeadwayTicks, TRANSIT_LIMITS.maxHeadwayTicks)),
        fare: Math.round(clamp(line.fare, TRANSIT_LIMITS.minFare, TRANSIT_LIMITS.maxFare) * 100) / 100,
        enabled: Boolean(line.enabled) && line.stopIds.length >= 2,
      }));
    }
    this.nextStopId = Math.max(1, Math.floor(snapshot.nextStopId));
    this.nextLineId = Math.max(1, Math.floor(snapshot.nextLineId));
    this.revision = Math.max(0, Math.floor(snapshot.revision));
  }

  private requireLine(id: string): TransitLine {
    const line = this.lines.get(id);
    if (!line) throw new Error(`unknown transit line: ${id}`);
    return line;
  }
}
