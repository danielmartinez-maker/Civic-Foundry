import type { TerrainGrid } from '../../world/terrain/TerrainGrid.ts';
import type { RoadSystem } from '../../world/roads/RoadSystem.ts';
import type { TreasurySystem } from '../treasury/TreasurySystem.ts';
import type { Building } from '../buildings/BuildingSystem.ts';
import { definitionForBuilding } from '../buildings/BuildingSystem.ts';
import {
  UTILITY_CORRIDOR_CAPACITY,
  UTILITY_CORRIDOR_OPERATING_COST,
  UTILITY_DEFINITIONS,
  type UtilityFacilityType,
} from '../../data/utilities.ts';
import { cellKey, type CellCoord } from '../core/types.ts';
import { PowerNetworkSystem, type PowerNetworkSnapshot } from './PowerNetworkSystem.ts';
import { WaterNetworkSystem, type WaterNetworkSnapshot } from './WaterNetworkSystem.ts';
import { UtilityTopologySystem } from './UtilityTopologySystem.ts';
import type {
  DevelopmentUtilityHeadroom,
  UtilityCorridorCell,
  UtilityCorridorType,
  UtilityFacility as InfrastructureUtilityFacility,
  UtilityInfrastructureState,
  UtilityMutationResult,
  UtilityTier,
} from './UtilityInfrastructureTypes.ts';

export type UtilityFacility = InfrastructureUtilityFacility;
export type ResourceSnapshot = Readonly<{ production: number; demand: number; served: number; unserved: number; serviceRatio: number }>;
export type UtilityBuildingService = Readonly<{
  power: number;
  water: number;
  powerDelivered: number;
  waterDelivered: number;
  waterPressureEligible: boolean;
  waterPressureMargin: number;
  limitingReason?: DevelopmentUtilityHeadroom['limitingReason'];
}>;
export type UtilityNetworkSegmentSnapshot = Readonly<{
  id: string;
  type: UtilityCorridorType;
  tier: UtilityTier;
  x: number;
  y: number;
  capacity: number;
  realizedFlow: number;
  utilization: number;
  residualCapacity: number;
  saturatedCycles: number;
  trippedUntilTick: number;
  tripped: boolean;
  pressureMargin?: number;
}>;
export type UtilityNetworkDiagnosticSnapshot = Readonly<{
  segments: Readonly<Record<string, UtilityNetworkSegmentSnapshot>>;
  edgeFlow: Readonly<Record<string, number>>;
}>;
export type UtilitySnapshot = Readonly<{
  power: ResourceSnapshot;
  water: ResourceSnapshot;
  perBuilding: Readonly<Record<string, UtilityBuildingService>>;
  powerNetwork: UtilityNetworkDiagnosticSnapshot;
  waterNetwork: UtilityNetworkDiagnosticSnapshot;
  networkOperatingCost: number;
  saturatedSegments: number;
  trippedSegments: number;
}>;

const CARDINAL = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
const POWER_CORRIDORS = new Set<UtilityCorridorType>(['power_distribution', 'power_transmission']);
const WATER_CORRIDORS = new Set<UtilityCorridorType>(['water_main', 'water_trunk']);

export type RoadComponentIndex = Readonly<{
  byRoadKey: Map<string, number>;
  adjacentComponent(x: number, y: number): number | undefined;
}>;

export function buildRoadComponentIndex(roads: RoadSystem): RoadComponentIndex {
  const roadList = roads.list();
  const roadKeys = new Set(roadList.map((road) => cellKey(road.x, road.y)));
  const byRoadKey = new Map<string, number>();
  let nextComponent = 1;
  for (const road of roadList) {
    const startKey = cellKey(road.x, road.y);
    if (byRoadKey.has(startKey)) continue;
    const component = nextComponent++;
    const queue: Array<[number, number]> = [[road.x, road.y]];
    byRoadKey.set(startKey, component);
    for (let i = 0; i < queue.length; i++) {
      const current = queue[i];
      if (!current) continue;
      const [x, y] = current;
      for (const [dx, dy] of CARDINAL) {
        const key = cellKey(x + dx, y + dy);
        if (roadKeys.has(key) && !byRoadKey.has(key)) {
          byRoadKey.set(key, component);
          queue.push([x + dx, y + dy]);
        }
      }
    }
  }
  return {
    byRoadKey,
    adjacentComponent(x: number, y: number): number | undefined {
      for (const [dx, dy] of CARDINAL) {
        const component = byRoadKey.get(cellKey(x + dx, y + dy));
        if (component !== undefined) return component;
      }
      return undefined;
    },
  };
}

function cloneFacility(facility: UtilityFacility): UtilityFacility {
  return Object.freeze({
    ...facility,
    ...(facility.inputCoord ? { inputCoord: Object.freeze({ ...facility.inputCoord }) } : {}),
    ...(facility.outputCoord ? { outputCoord: Object.freeze({ ...facility.outputCoord }) } : {}),
  });
}

function stableRecord<T>(entries: readonly (readonly [string, T])[]): Readonly<Record<string, T>> {
  return Object.freeze(Object.fromEntries([...entries].sort((a, b) => a[0].localeCompare(b[0]))) as Record<string, T>);
}

function finiteNonNegative(value: number): boolean {
  return Number.isFinite(value) && value >= 0;
}

export class UtilitySystem {
  private readonly terrain: TerrainGrid;
  private readonly roads: RoadSystem;
  private readonly facilities: UtilityFacility[] = [];
  private readonly topology: UtilityTopologySystem;
  private readonly powerNetwork = new PowerNetworkSystem();
  private readonly waterNetwork: WaterNetworkSystem;
  private nextId = 1;
  private lastProtectionAccountingTick = 0;
  private lastTick = 0;
  private lastBuildings: Building[] = [];
  private lastPowerNetwork?: PowerNetworkSnapshot;
  private lastWaterNetwork?: WaterNetworkSnapshot;
  private lastSnapshot?: UtilitySnapshot;
  private flowRevision = 0;
  private lastFlowSignature = '';
  private readonly headroomCache = new Map<string, DevelopmentUtilityHeadroom>();

  constructor(terrain: TerrainGrid, roads: RoadSystem) {
    this.terrain = terrain;
    this.roads = roads;
    this.topology = new UtilityTopologySystem(terrain, roads);
    this.waterNetwork = new WaterNetworkSystem(terrain);
  }

  placeFacility(
    type: UtilityFacilityType,
    x: number,
    y: number,
    treasury: TreasurySystem,
    inputCoord?: CellCoord,
    outputCoord?: CellCoord,
  ): UtilityMutationResult {
    const definition = UTILITY_DEFINITIONS[type];
    if (!definition) return { ok: false, cost: 0, reason: 'invalid utility facility type' };
    if (!this.terrain.isBuildable(x, y)) return { ok: false, cost: definition.constructionCost, reason: 'unbuildable terrain' };
    if (this.roads.has(x, y)) return { ok: false, cost: definition.constructionCost, reason: 'road occupies cell' };
    if (this.facilities.some((facility) => facility.x === x && facility.y === y)) {
      return { ok: false, cost: definition.constructionCost, reason: 'facility occupies cell' };
    }
    const components = buildRoadComponentIndex(this.roads);
    if (components.adjacentComponent(x, y) === undefined) {
      return { ok: false, cost: definition.constructionCost, reason: 'road access required' };
    }

    const bridgeReason = this.validateBridgeEndpoints(type, x, y, inputCoord, outputCoord);
    if (bridgeReason) return { ok: false, cost: definition.constructionCost, reason: bridgeReason };
    if (!treasury.tryDebit(definition.constructionCost, `Build ${type}`)) {
      return { ok: false, cost: definition.constructionCost, reason: 'insufficient funds' };
    }

    const facility: UtilityFacility = Object.freeze({
      id: `utility:${this.nextId++}`,
      type,
      x,
      y,
      ...(inputCoord ? { inputCoord: Object.freeze({ ...inputCoord }) } : {}),
      ...(outputCoord ? { outputCoord: Object.freeze({ ...outputCoord }) } : {}),
    });
    this.facilities.push(facility);
    if (type === 'power' || type === 'water') this.seedSourceStub(facility);
    this.invalidateDerived();
    return { ok: true, cost: definition.constructionCost };
  }

  buildPath(
    type: UtilityCorridorType,
    tier: UtilityTier,
    coords: readonly CellCoord[],
    treasury: TreasurySystem,
  ): UtilityMutationResult {
    const result = this.topology.placePath(type, tier, coords, treasury);
    if (result.ok) this.invalidateDerived();
    return result;
  }

  upgradePath(type: UtilityCorridorType, coords: readonly CellCoord[], treasury: TreasurySystem): UtilityMutationResult {
    const result = this.topology.upgradePath(type, coords, treasury);
    if (result.ok) this.invalidateDerived();
    return result;
  }

  removePathAt(type: UtilityCorridorType, x: number, y: number): UtilityMutationResult {
    const removed = this.topology.removeAt(type, x, y);
    if (!removed) return { ok: false, cost: 0, reason: 'corridor missing' };
    this.invalidateDerived();
    return { ok: true, cost: 0 };
  }

  removeFacilityAt(x: number, y: number): UtilityFacility | undefined {
    const index = this.facilities.findIndex((facility) => facility.x === x && facility.y === y);
    if (index < 0) return undefined;
    const [removed] = this.facilities.splice(index, 1);
    if (!removed) return undefined;
    this.invalidateDerived();
    return cloneFacility(removed);
  }

  listFacilities(): UtilityFacility[] {
    return this.facilities.map(cloneFacility).sort((a, b) => a.id.localeCompare(b.id));
  }

  listCorridors(): UtilityCorridorCell[] {
    return this.topology.list();
  }

  operatingCost(): number {
    const facilityCost = this.facilities.reduce((sum, facility) => sum + UTILITY_DEFINITIONS[facility.type].operatingCost, 0);
    const networkCost = this.topology.list().reduce((sum, corridor) => {
      if (corridor.sourceStubForFacilityId) return sum;
      return sum + UTILITY_CORRIDOR_OPERATING_COST[corridor.type][corridor.tier];
    }, 0);
    return facilityCost + networkCost;
  }

  getNextId(): number {
    return this.nextId;
  }

  restore(facilities: readonly UtilityFacility[], nextId: number): void {
    this.facilities.length = 0;
    this.facilities.push(...facilities.map(cloneFacility));
    this.nextId = Math.max(1, Math.floor(nextId));
    this.invalidateDerived();
  }

  snapshotState(): UtilityInfrastructureState {
    return Object.freeze({
      topology: this.topology.snapshotState(),
      facilities: Object.freeze(this.listFacilities().map(cloneFacility)),
      nextFacilityId: this.nextId,
      lastProtectionAccountingTick: this.lastProtectionAccountingTick,
    });
  }

  restoreState(state: UtilityInfrastructureState): void {
    if (!Number.isInteger(state.nextFacilityId) || state.nextFacilityId < 1) throw new Error('invalid utility next facility id');
    if (!Number.isInteger(state.lastProtectionAccountingTick) || state.lastProtectionAccountingTick < 0) {
      throw new Error('invalid utility protection accounting tick');
    }
    this.topology.restoreState(state.topology);

    const ids = new Set<string>();
    const coords = new Set<string>();
    const restored: UtilityFacility[] = [];
    for (const raw of state.facilities) {
      if (!raw.id || ids.has(raw.id)) throw new Error('duplicate utility facility id');
      ids.add(raw.id);
      if (!UTILITY_DEFINITIONS[raw.type]) throw new Error('invalid utility facility type');
      if (!Number.isInteger(raw.x) || !Number.isInteger(raw.y) || !this.terrain.inBounds(raw.x, raw.y) || !this.terrain.isBuildable(raw.x, raw.y)) {
        throw new Error('invalid utility facility coordinate');
      }
      const key = cellKey(raw.x, raw.y);
      if (coords.has(key)) throw new Error('duplicate utility facility coordinate');
      coords.add(key);
      const bridgeReason = this.validateRestoredBridge(raw);
      if (bridgeReason) throw new Error(bridgeReason);
      restored.push(cloneFacility(raw));
    }

    const byFacilityId = new Map(restored.map((facility) => [facility.id, facility] as const));
    for (const corridor of this.topology.list()) {
      if (!corridor.sourceStubForFacilityId) continue;
      const source = byFacilityId.get(corridor.sourceStubForFacilityId);
      if (!source) throw new Error('utility source stub references missing facility');
      if (source.type === 'power' && corridor.type !== 'power_distribution') throw new Error('power source stub has invalid corridor type');
      if (source.type === 'water' && corridor.type !== 'water_main') throw new Error('water source stub has invalid corridor type');
      if (source.type !== 'power' && source.type !== 'water') throw new Error('utility source stub references non-source facility');
    }

    this.facilities.length = 0;
    this.facilities.push(...restored);
    this.nextId = state.nextFacilityId;
    this.lastProtectionAccountingTick = state.lastProtectionAccountingTick;
    this.lastTick = 0;
    this.lastBuildings = [];
    this.flowRevision = 0;
    this.lastFlowSignature = '';
    this.invalidateDerived();
  }

  evaluate(buildings: readonly Building[], tick?: number): UtilitySnapshot {
    if (tick === undefined) return this.evaluateLegacy(buildings);
    if (!Number.isFinite(tick) || tick < 0 || !Number.isInteger(tick)) throw new Error('utility tick must be a non-negative integer');
    if (tick !== this.lastTick) this.headroomCache.clear();
    this.lastTick = tick;
    this.lastBuildings = buildings.map((building) => ({ ...building }));

    let { power, water } = this.evaluateExplicitNetworks(buildings, tick);
    const protection = this.accountProtection(power, water, tick);
    if (protection.newTrip) ({ power, water } = this.evaluateExplicitNetworks(buildings, tick));
    this.trackFlowRevision(power, water);
    this.lastPowerNetwork = power;
    this.lastWaterNetwork = water;
    this.lastSnapshot = this.composeSnapshot(buildings, tick, power, water);
    return this.lastSnapshot;
  }

  evaluateDevelopmentHeadroom(x: number, y: number, powerDemand: number, waterDemand: number): DevelopmentUtilityHeadroom {
    if (!Number.isInteger(x) || !Number.isInteger(y) || !this.terrain.inBounds(x, y)) throw new Error('invalid utility headroom coordinate');
    if (!finiteNonNegative(powerDemand) || !finiteNonNegative(waterDemand)) throw new Error('utility headroom demand must be finite and non-negative');

    if (!this.lastPowerNetwork || !this.lastWaterNetwork) {
      const evaluated = this.evaluateExplicitNetworks(this.lastBuildings, this.lastTick);
      this.trackFlowRevision(evaluated.power, evaluated.water);
      this.lastPowerNetwork = evaluated.power;
      this.lastWaterNetwork = evaluated.water;
    }
    const key = `${this.topology.revision}|${this.flowRevision}|${x},${y}|${powerDemand}|${waterDemand}`;
    const cached = this.headroomCache.get(key);
    if (cached) return cached;

    const corridors = this.topology.list();
    const facilities = this.listFacilities();
    const power = this.powerNetwork.evaluateAdditionalHeadroom({
      x,
      y,
      demand: powerDemand,
      snapshot: this.lastPowerNetwork,
      corridors,
      facilities,
      tick: this.lastTick,
    });
    const water = this.waterNetwork.evaluateAdditionalHeadroom({
      x,
      y,
      demand: waterDemand,
      snapshot: this.lastWaterNetwork,
      corridors,
      facilities,
      tick: this.lastTick,
    });

    const limitingReason = this.headroomLimitingReason(power.serviceRatio, power.limitingReason, water.serviceRatio, water.limitingReason);
    const result: DevelopmentUtilityHeadroom = Object.freeze({
      powerHeadroom: power.deliverable,
      waterHeadroom: water.deliverable,
      powerServiceRatio: power.serviceRatio,
      waterServiceRatio: water.serviceRatio,
      utilityRatio: Math.min(power.serviceRatio, water.serviceRatio),
      waterPressureEligible: water.pressureEligible,
      waterPressureMargin: water.pressureMargin,
      ...(limitingReason ? { limitingReason } : {}),
    });
    this.headroomCache.set(key, result);
    return result;
  }

  private evaluateExplicitNetworks(buildings: readonly Building[], tick: number): Readonly<{ power: PowerNetworkSnapshot; water: WaterNetworkSnapshot }> {
    const demands = buildings
      .filter((building) => building.status === 'occupied')
      .map((building) => {
        const definition = definitionForBuilding(building);
        return {
          id: building.id,
          x: building.x,
          y: building.y,
          power: definition.powerDemand,
          water: definition.waterDemand,
        };
      });
    const corridors = this.topology.list();
    const facilities = this.listFacilities();
    return Object.freeze({
      power: this.powerNetwork.evaluate({
        corridors,
        facilities,
        demands: demands.map((item) => ({ id: item.id, x: item.x, y: item.y, demand: item.power })),
        tick,
      }),
      water: this.waterNetwork.evaluate({
        corridors,
        facilities,
        demands: demands.map((item) => ({ id: item.id, x: item.x, y: item.y, demand: item.water })),
        tick,
      }),
    });
  }

  private accountProtection(power: PowerNetworkSnapshot, water: WaterNetworkSnapshot, tick: number): Readonly<{ changed: boolean; newTrip: boolean }> {
    if (tick <= 0 || tick % 50 !== 0 || tick <= this.lastProtectionAccountingTick) return Object.freeze({ changed: false, newTrip: false });
    const updates: Array<{ id: string; saturatedCycles: number; trippedUntilTick: number }> = [];
    let newTrip = false;
    for (const cell of this.topology.list()) {
      const isTripped = tick < cell.trippedUntilTick;
      if (isTripped) {
        updates.push({ id: cell.id, saturatedCycles: 0, trippedUntilTick: cell.trippedUntilTick });
        continue;
      }
      const service = POWER_CORRIDORS.has(cell.type) ? power.perCorridor[cell.id] : water.perCorridor[cell.id];
      const saturated = (service?.utilization ?? 0) >= 0.98;
      if (!saturated) {
        updates.push({ id: cell.id, saturatedCycles: 0, trippedUntilTick: cell.trippedUntilTick });
        continue;
      }
      const nextCycles = cell.saturatedCycles + 1;
      if (nextCycles >= 3) {
        updates.push({ id: cell.id, saturatedCycles: 0, trippedUntilTick: tick + 100 });
        newTrip = true;
      } else {
        updates.push({ id: cell.id, saturatedCycles: nextCycles, trippedUntilTick: cell.trippedUntilTick });
      }
    }
    this.lastProtectionAccountingTick = tick;
    const changed = this.topology.updateProtectionStates(updates);
    if (changed) this.headroomCache.clear();
    return Object.freeze({ changed, newTrip });
  }

  private composeSnapshot(
    buildings: readonly Building[],
    tick: number,
    power: PowerNetworkSnapshot,
    water: WaterNetworkSnapshot,
  ): UtilitySnapshot {
    const perBuildingEntries: Array<readonly [string, UtilityBuildingService]> = [];
    for (const building of buildings.filter((item) => item.status === 'occupied').sort((a, b) => a.id.localeCompare(b.id))) {
      const powerService = power.perBuilding[building.id];
      const waterService = water.perBuilding[building.id];
      const powerRatio = powerService?.serviceRatio ?? 0;
      const waterRatio = waterService?.serviceRatio ?? 0;
      const limitingReason = this.buildingLimitingReason(powerService, waterService);
      perBuildingEntries.push([building.id, Object.freeze({
        power: powerRatio,
        water: waterRatio,
        powerDelivered: powerService?.delivered ?? 0,
        waterDelivered: waterService?.delivered ?? 0,
        waterPressureEligible: waterService?.pressureEligible ?? false,
        waterPressureMargin: waterService?.pressureMargin ?? 0,
        ...(limitingReason ? { limitingReason } : {}),
      })]);
    }

    const powerDiagnostic = this.networkDiagnostic(tick, power, undefined, POWER_CORRIDORS);
    const waterDiagnostic = this.networkDiagnostic(tick, undefined, water, WATER_CORRIDORS);
    const segments = [...Object.values(powerDiagnostic.segments), ...Object.values(waterDiagnostic.segments)];
    return Object.freeze({
      power: Object.freeze({
        production: power.production,
        demand: power.demand,
        served: power.delivered,
        unserved: power.unserved,
        serviceRatio: power.serviceRatio,
      }),
      water: Object.freeze({
        production: water.production,
        demand: water.demand,
        served: water.delivered,
        unserved: water.unserved,
        serviceRatio: water.serviceRatio,
      }),
      perBuilding: stableRecord(perBuildingEntries),
      powerNetwork: powerDiagnostic,
      waterNetwork: waterDiagnostic,
      networkOperatingCost: this.operatingCost(),
      saturatedSegments: segments.filter((segment) => !segment.tripped && segment.utilization >= 0.98).length,
      trippedSegments: segments.filter((segment) => segment.tripped).length,
    });
  }

  private networkDiagnostic(
    tick: number,
    power: PowerNetworkSnapshot | undefined,
    water: WaterNetworkSnapshot | undefined,
    allowedTypes: ReadonlySet<UtilityCorridorType>,
  ): UtilityNetworkDiagnosticSnapshot {
    const entries: Array<readonly [string, UtilityNetworkSegmentSnapshot]> = [];
    for (const cell of this.topology.list().filter((item) => allowedTypes.has(item.type))) {
      const service = power?.perCorridor[cell.id] ?? water?.perCorridor[cell.id];
      const capacity = service?.capacity ?? UTILITY_CORRIDOR_CAPACITY[cell.type][cell.tier];
      const pressureMargin = water?.perCorridor[cell.id]?.pressureHead;
      entries.push([cell.id, Object.freeze({
        id: cell.id,
        type: cell.type,
        tier: cell.tier,
        x: cell.x,
        y: cell.y,
        capacity,
        realizedFlow: service?.flow ?? 0,
        utilization: service?.utilization ?? 0,
        residualCapacity: service?.residualCapacity ?? capacity,
        saturatedCycles: cell.saturatedCycles,
        trippedUntilTick: cell.trippedUntilTick,
        tripped: tick < cell.trippedUntilTick,
        ...(pressureMargin !== undefined ? { pressureMargin } : {}),
      })]);
    }
    return Object.freeze({
      segments: stableRecord(entries),
      edgeFlow: power?.edgeFlow ?? water?.edgeFlow ?? Object.freeze({}),
    });
  }

  private trackFlowRevision(power: PowerNetworkSnapshot, water: WaterNetworkSnapshot): void {
    const signature = JSON.stringify([power.edgeFlow, water.edgeFlow]);
    if (signature === this.lastFlowSignature) return;
    this.lastFlowSignature = signature;
    this.flowRevision++;
    this.headroomCache.clear();
  }

  private invalidateDerived(): void {
    this.lastPowerNetwork = undefined;
    this.lastWaterNetwork = undefined;
    this.lastSnapshot = undefined;
    this.headroomCache.clear();
  }

  private validateBridgeEndpoints(
    type: UtilityFacilityType,
    x: number,
    y: number,
    inputCoord?: CellCoord,
    outputCoord?: CellCoord,
  ): string | undefined {
    if (type !== 'power_substation' && type !== 'water_pump') {
      if (inputCoord || outputCoord) return 'bridge endpoints are only valid for substations and pumps';
      return undefined;
    }
    if (!inputCoord || !outputCoord) return 'bridge endpoints required';
    if (inputCoord.x === outputCoord.x && inputCoord.y === outputCoord.y) return 'bridge endpoints must be distinct';
    if (Math.abs(inputCoord.x - x) + Math.abs(inputCoord.y - y) !== 1 || Math.abs(outputCoord.x - x) + Math.abs(outputCoord.y - y) !== 1) {
      return 'bridge endpoints must be adjacent to facility';
    }
    if (type === 'power_substation') {
      if (!this.topology.get('power_transmission', inputCoord.x, inputCoord.y)) return 'power transmission input required';
      if (!this.topology.get('power_distribution', outputCoord.x, outputCoord.y)) return 'power distribution output required';
      return undefined;
    }
    if (!this.topology.get('water_trunk', inputCoord.x, inputCoord.y)) return 'water trunk input required';
    if (!this.topology.get('water_main', outputCoord.x, outputCoord.y)) return 'water main output required';
    return undefined;
  }

  private validateRestoredBridge(facility: UtilityFacility): string | undefined {
    if (facility.type === 'power_substation' || facility.type === 'water_pump') {
      return this.validateBridgeEndpoints(facility.type, facility.x, facility.y, facility.inputCoord, facility.outputCoord);
    }
    if (facility.inputCoord || facility.outputCoord) return 'non-bridge utility facility has bridge endpoints';
    return undefined;
  }

  private seedSourceStub(facility: UtilityFacility): void {
    if (facility.type !== 'power' && facility.type !== 'water') return;
    const corridorType: UtilityCorridorType = facility.type === 'power' ? 'power_distribution' : 'water_main';
    const adjacentRoads = CARDINAL
      .map(([dx, dy]) => ({ x: facility.x + dx, y: facility.y + dy }))
      .filter((coord) => this.roads.has(coord.x, coord.y))
      .sort((a, b) => a.x - b.x || a.y - b.y);
    const target = adjacentRoads[0];
    if (!target || this.topology.get(corridorType, target.x, target.y)) return;
    this.topology.seedCell(corridorType, 1, target.x, target.y, facility.id);
  }

  private headroomLimitingReason(
    powerRatio: number,
    powerReason: 'no-distribution-connection' | 'capacity' | undefined,
    waterRatio: number,
    waterReason: 'no-main-connection' | 'pressure' | 'capacity' | undefined,
  ): DevelopmentUtilityHeadroom['limitingReason'] | undefined {
    if (powerRatio >= 1 && waterRatio >= 1) return undefined;
    if (powerReason === 'no-distribution-connection') return 'power-connection';
    if (waterReason === 'no-main-connection') return 'water-connection';
    if (waterReason === 'pressure') return 'water-pressure';
    if (powerRatio <= waterRatio && powerRatio < 1) return 'power-capacity';
    if (waterRatio < 1) return 'water-capacity';
    return 'power-capacity';
  }

  private buildingLimitingReason(
    power: PowerNetworkSnapshot['perBuilding'][string] | undefined,
    water: WaterNetworkSnapshot['perBuilding'][string] | undefined,
  ): DevelopmentUtilityHeadroom['limitingReason'] | undefined {
    const powerRatio = power?.serviceRatio ?? 0;
    const waterRatio = water?.serviceRatio ?? 0;
    if (powerRatio >= 1 && waterRatio >= 1) return undefined;
    if ((power?.connectionCellIds.length ?? 0) === 0) return 'power-connection';
    if ((water?.connectionCellIds.length ?? 0) === 0) return 'water-connection';
    if (water && !water.pressureEligible) return 'water-pressure';
    return powerRatio <= waterRatio ? 'power-capacity' : 'water-capacity';
  }

  private evaluateLegacy(buildings: readonly Building[]): UtilitySnapshot {
    const components = buildRoadComponentIndex(this.roads);
    const componentPower = new Map<number, number>();
    const componentWater = new Map<number, number>();
    for (const facility of this.facilities) {
      const component = components.adjacentComponent(facility.x, facility.y);
      if (component === undefined) continue;
      if (facility.type === 'power') componentPower.set(component, (componentPower.get(component) ?? 0) + UTILITY_DEFINITIONS.power.capacity);
      if (facility.type === 'water') componentWater.set(component, (componentWater.get(component) ?? 0) + UTILITY_DEFINITIONS.water.capacity);
    }

    const demandByComponent = new Map<number, { power: number; water: number }>();
    let totalPowerDemand = 0;
    let totalWaterDemand = 0;
    for (const building of buildings) {
      if (building.status !== 'occupied') continue;
      const definition = definitionForBuilding(building);
      totalPowerDemand += definition.powerDemand;
      totalWaterDemand += definition.waterDemand;
      const component = components.adjacentComponent(building.x, building.y);
      if (component === undefined) continue;
      const demand = demandByComponent.get(component) ?? { power: 0, water: 0 };
      demand.power += definition.powerDemand;
      demand.water += definition.waterDemand;
      demandByComponent.set(component, demand);
    }

    const perBuildingEntries: Array<readonly [string, UtilityBuildingService]> = [];
    let servedPower = 0;
    let servedWater = 0;
    for (const building of buildings) {
      if (building.status !== 'occupied') continue;
      const definition = definitionForBuilding(building);
      const component = components.adjacentComponent(building.x, building.y);
      const componentDemand = component === undefined ? { power: 0, water: 0 } : (demandByComponent.get(component) ?? { power: 0, water: 0 });
      const powerRatio = component === undefined || componentDemand.power === 0 ? (component === undefined ? 0 : 1) : Math.min(1, (componentPower.get(component) ?? 0) / componentDemand.power);
      const waterRatio = component === undefined || componentDemand.water === 0 ? (component === undefined ? 0 : 1) : Math.min(1, (componentWater.get(component) ?? 0) / componentDemand.water);
      servedPower += definition.powerDemand * powerRatio;
      servedWater += definition.waterDemand * waterRatio;
      perBuildingEntries.push([building.id, Object.freeze({
        power: powerRatio,
        water: waterRatio,
        powerDelivered: definition.powerDemand * powerRatio,
        waterDelivered: definition.waterDemand * waterRatio,
        waterPressureEligible: waterRatio > 0,
        waterPressureMargin: waterRatio > 0 ? 8 : 0,
        ...((powerRatio < 1 || waterRatio < 1) ? { limitingReason: powerRatio <= waterRatio ? 'power-capacity' as const : 'water-capacity' as const } : {}),
      })]);
    }

    const productionPower = [...componentPower.values()].reduce((a, b) => a + b, 0);
    const productionWater = [...componentWater.values()].reduce((a, b) => a + b, 0);
    const powerDiagnostic = this.networkDiagnostic(0, undefined, undefined, POWER_CORRIDORS);
    const waterDiagnostic = this.networkDiagnostic(0, undefined, undefined, WATER_CORRIDORS);
    const snapshot: UtilitySnapshot = Object.freeze({
      power: Object.freeze({
        production: productionPower,
        demand: totalPowerDemand,
        served: servedPower,
        unserved: Math.max(0, totalPowerDemand - servedPower),
        serviceRatio: totalPowerDemand === 0 ? 1 : servedPower / totalPowerDemand,
      }),
      water: Object.freeze({
        production: productionWater,
        demand: totalWaterDemand,
        served: servedWater,
        unserved: Math.max(0, totalWaterDemand - servedWater),
        serviceRatio: totalWaterDemand === 0 ? 1 : servedWater / totalWaterDemand,
      }),
      perBuilding: stableRecord(perBuildingEntries),
      powerNetwork: powerDiagnostic,
      waterNetwork: waterDiagnostic,
      networkOperatingCost: this.operatingCost(),
      saturatedSegments: 0,
      trippedSegments: 0,
    });
    this.lastSnapshot = snapshot;
    return snapshot;
  }
}
