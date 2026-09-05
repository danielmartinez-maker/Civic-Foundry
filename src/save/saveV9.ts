import { bindNativeUrbanMutationsAfterHydration } from '../native/urban/NativeUrbanHydrationBinding.ts';
import {
  activeNativeUrbanAuthorityOverride,
  withNativeUrbanAuthoritySuspended,
} from '../native/urban/NativeUrbanAuthority.ts';
import type { BuildingV2 } from '../simulation/buildings/BuildingTypes.ts';
import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { PropertyMarketSnapshot } from '../simulation/development/PropertyMarketSystem.ts';
import type { ParcelZoningAssignment } from '../simulation/zoning/ZoningTypes.ts';
import type { CadastralSnapshot } from '../world/cadastre/CadastralTypes.ts';
import { hydrateCoreV8, serializeCoreV8, type SaveV8 } from './saveV8.ts';

export type SaveV9 = Omit<SaveV8, 'saveVersion' | 'gameVersion'> & Readonly<{
  saveVersion: 9;
  gameVersion: '0.9.0-urban-fabric';
  urbanFabric: CadastralSnapshot;
  zoningV2: Readonly<{ parcelAssignments: readonly ParcelZoningAssignment[] }>;
  buildingsV2: readonly BuildingV2[];
  propertyMarket: PropertyMarketSnapshot;
}>;

export function serializeCoreV9(core: SimulationCore, baseV8: SaveV8 = serializeCoreV8(core)): SaveV9 {
  const compatibilitySave: SaveV9 = {
    ...baseV8,
    saveVersion: 9,
    gameVersion: '0.9.0-urban-fabric',
    urbanFabric: core.cadastre.snapshot(),
    zoningV2: Object.freeze({ parcelAssignments: core.zoning.listParcelAssignments() }),
    buildingsV2: core.buildings.listV2(),
    propertyMarket: core.propertyMarket.snapshot(),
  };
  const native = activeNativeUrbanAuthorityOverride();
  if (!native?.enabled) return compatibilitySave;
  native.bridge.loadV9(compatibilitySave);
  return native.bridge.saveV9<SaveV9>();
}

export function hydrateCoreV9(input: unknown): SimulationCore {
  if (!isRecord(input) || input.saveVersion !== 9) return hydrateCoreV8(input);
  if (input.gameVersion !== '0.9.0-urban-fabric') throw new Error('invalid V9 game version');
  if (!isRecord(input.urbanFabric)) throw new Error('urbanFabric must be an object');
  if (!isRecord(input.zoningV2) || !Array.isArray(input.zoningV2.parcelAssignments)) throw new Error('zoningV2 parcel assignments must be an array');
  if (!Array.isArray(input.buildingsV2)) throw new Error('buildingsV2 must be an array');
  if (!isRecord(input.propertyMarket)) throw new Error('propertyMarket must be an object');
  validateAdversarialState(input);

  const save = input as unknown as SaveV9;
  validateRawUrbanFabricReferences(save);
  const native = activeNativeUrbanAuthorityOverride();
  const authoritativeUrban = native?.enabled
    ? (() => {
        native.bridge.loadV9(save);
        return native.bridge.urbanSnapshot();
      })()
    : Object.freeze({
        urbanFabric: save.urbanFabric,
        zoningV2: save.zoningV2,
        buildingsV2: save.buildingsV2,
        propertyMarket: save.propertyMarket,
      });

  const { urbanFabric: _urbanFabric, zoningV2: _zoningV2, buildingsV2: _buildingsV2, propertyMarket: _propertyMarket, ...withoutUrbanFabric } = save;
  const v8: SaveV8 = { ...withoutUrbanFabric, saveVersion: 8, gameVersion: '0.8.0-world-foundation' };
  const core = native?.enabled
    ? withNativeUrbanAuthoritySuspended(() => hydrateCoreV8(v8))
    : hydrateCoreV8(v8);

  core.cadastre.replaceSnapshot(authoritativeUrban.urbanFabric);
  core.lots.rebuildFromCadastre(core.cadastre, (parcel) => {
    const zone = parcel.zoningDistrictId;
    return zone === 'residential' || zone === 'commercial' || zone === 'industrial' ? zone : undefined;
  });
  const historicalParcelIds = new Set(core.cadastre.listLineage().flatMap((event) => event.sourceParcelIds));
  validateUrbanFabricReferences(
    core,
    authoritativeUrban.zoningV2.parcelAssignments,
    authoritativeUrban.buildingsV2,
    authoritativeUrban.propertyMarket,
    historicalParcelIds,
  );
  core.zoning.restoreParcelAssignments(authoritativeUrban.zoningV2.parcelAssignments);
  core.buildings.restoreV2(authoritativeUrban.buildingsV2);
  core.propertyMarket.restore(authoritativeUrban.propertyMarket, {
    isHistoricalParcelId: (parcelId) => historicalParcelIds.has(parcelId),
  });
  if (native?.enabled) bindNativeUrbanMutationsAfterHydration(core, native.bridge);
  return core;
}

function validateAdversarialState(root: Record<string, unknown>): void {
  validateFiniteAndLocalIds(root, 'save');
  validateTransitState(root);
  validateEconomyState(root);
  validateUrbanFabricShape(root);
}

function validateFiniteAndLocalIds(value: unknown, path: string): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`${path} contains non-finite number`);
    return;
  }
  if (Array.isArray(value)) {
    const ids = new Set<string>();
    for (let index = 0; index < value.length; index++) {
      const item = value[index];
      if (isRecord(item) && 'id' in item) {
        if (typeof item.id !== 'string' || item.id.trim().length === 0) throw new Error(`${path}[${index}] has invalid id`);
        if (ids.has(item.id)) throw new Error(`${path} contains duplicate id: ${item.id}`);
        ids.add(item.id);
      }
      validateFiniteAndLocalIds(item, `${path}[${index}]`);
    }
    return;
  }
  if (!isRecord(value)) return;
  for (const [key, child] of Object.entries(value)) validateFiniteAndLocalIds(child, `${path}.${key}`);
}

function validateUrbanFabricShape(root: Record<string, unknown>): void {
  const urban = requireRecord(root.urbanFabric, 'urbanFabric');
  const parcels = requireArray(urban.parcels, 'urbanFabric.parcels');
  const parcelIds = new Set<string>();
  for (const raw of parcels) {
    const parcel = requireRecord(raw, 'urbanFabric parcel');
    const id = requireNonEmptyString(parcel.id, 'urbanFabric parcel id');
    parcelIds.add(id);
  }
  const zoning = requireRecord(root.zoningV2, 'zoningV2');
  const assignmentKeys = new Set<string>();
  for (const raw of requireArray(zoning.parcelAssignments, 'zoningV2.parcelAssignments')) {
    const assignment = requireRecord(raw, 'zoning assignment');
    const parcelId = requireNonEmptyString(assignment.parcelId, 'zoning assignment parcelId');
    if (assignmentKeys.has(parcelId)) throw new Error(`duplicate parcel zoning assignment: ${parcelId}`);
    assignmentKeys.add(parcelId);
  }
  const property = requireRecord(root.propertyMarket, 'propertyMarket');
  const holdingKeys = new Set<string>();
  for (const raw of requireArray(property.holdings, 'propertyMarket.holdings')) {
    const holding = requireRecord(raw, 'property holding');
    const parcelId = requireNonEmptyString(holding.parcelId, 'property holding parcelId');
    if (holdingKeys.has(parcelId)) throw new Error(`duplicate property holding: ${parcelId}`);
    holdingKeys.add(parcelId);
  }
  for (const raw of requireArray(root.buildingsV2, 'buildingsV2')) {
    const building = requireRecord(raw, 'canonical building');
    const parcelRefs = requireArray(building.parcelIds, `building ${String(building.id)} parcelIds`);
    if (parcelRefs.length === 0) throw new Error(`building ${String(building.id)} has no parcels`);
    const unique = new Set<string>();
    for (const value of parcelRefs) {
      const parcelId = requireNonEmptyString(value, `building ${String(building.id)} parcelId`);
      if (unique.has(parcelId)) throw new Error(`building ${String(building.id)} has duplicate parcel: ${parcelId}`);
      unique.add(parcelId);
    }
  }
}

function validateRawUrbanFabricReferences(save: SaveV9): void {
  const parcelIds = new Set(save.urbanFabric.parcels.map((parcel) => parcel.id));
  const historicalIds = new Set(save.urbanFabric.lineage.flatMap((event) => event.sourceParcelIds));
  const requireParcel = (parcelId: string, source: string): void => {
    if (!parcelIds.has(parcelId)) throw new Error(`${source} references missing parcel: ${parcelId}`);
  };
  for (const assignment of save.zoningV2.parcelAssignments) requireParcel(assignment.parcelId, 'zoning assignment');
  for (const building of save.buildingsV2) for (const parcelId of building.parcelIds) requireParcel(parcelId, `building ${building.id}`);
  for (const holding of save.propertyMarket.holdings) requireParcel(holding.parcelId, 'property holding');
  for (const transaction of save.propertyMarket.transactions) {
    for (const parcelId of transaction.parcelIds) {
      if (!parcelIds.has(parcelId) && !historicalIds.has(parcelId)) throw new Error(`property transaction ${transaction.id} references unknown parcel history: ${parcelId}`);
    }
  }
}

function validateTransitState(root: Record<string, unknown>): void {
  if (!isRecord(root.transit)) return;
  const transit = root.transit;
  const network = requireRecord(transit.network, 'transit.network');
  const mobility = requireRecord(transit.mobility, 'transit.mobility');
  const stopIds = new Set(requireArray(network.stops, 'transit.network.stops').map((raw) => requireNonEmptyString(requireRecord(raw, 'transit stop').id, 'transit stop id')));
  const lineRecords = requireArray(network.lines, 'transit.network.lines').map((raw) => requireRecord(raw, 'transit line'));
  const lineIds = new Set(lineRecords.map((line) => requireNonEmptyString(line.id, 'transit line id')));
  for (const line of lineRecords) {
    const seenStops = new Set<string>();
    for (const value of requireArray(line.stopIds, `transit line ${String(line.id)} stopIds`)) {
      const stopId = requireNonEmptyString(value, 'transit line stop id');
      if (!stopIds.has(stopId)) throw new Error(`transit line references missing stop: ${stopId}`);
      if (seenStops.has(stopId)) throw new Error(`transit line contains duplicate stop: ${stopId}`);
      seenStops.add(stopId);
    }
  }

  const passengers = requireRecord(mobility.passengers, 'transit.mobility.passengers');
  const vehicles = requireRecord(mobility.vehicles, 'transit.mobility.vehicles');
  const operations = requireRecord(mobility.operations, 'transit.mobility.operations');
  const queueKeys = new Set<string>();
  const cohortIds = new Set<string>();
  const validateCohort = (raw: unknown, source: string): void => {
    const cohort = requireRecord(raw, source);
    const id = requireNonEmptyString(cohort.id, `${source} id`);
    if (cohortIds.has(id)) throw new Error(`duplicate transit passenger cohort: ${id}`);
    cohortIds.add(id);
    const lineId = requireNonEmptyString(cohort.lineId, `${source} lineId`);
    const boardingStopId = requireNonEmptyString(cohort.boardingStopId, `${source} boardingStopId`);
    const alightingStopId = requireNonEmptyString(cohort.alightingStopId, `${source} alightingStopId`);
    if (!lineIds.has(lineId) || !stopIds.has(boardingStopId) || !stopIds.has(alightingStopId)) throw new Error('invalid transit passenger reference');
    for (const legRaw of requireArray(cohort.transferLegs, `${source} transferLegs`)) {
      const leg = requireRecord(legRaw, 'transit transfer leg');
      const legLineId = requireNonEmptyString(leg.lineId, 'transit transfer lineId');
      const legBoard = requireNonEmptyString(leg.boardingStopId, 'transit transfer boardingStopId');
      const legAlight = requireNonEmptyString(leg.alightingStopId, 'transit transfer alightingStopId');
      if (!lineIds.has(legLineId) || !stopIds.has(legBoard) || !stopIds.has(legAlight)) throw new Error('invalid transit transfer reference');
    }
  };
  for (const raw of requireArray(passengers.queues, 'transit passenger queues')) {
    const queue = requireRecord(raw, 'transit passenger queue');
    const stopId = requireNonEmptyString(queue.stopId, 'transit queue stopId');
    const lineId = requireNonEmptyString(queue.lineId, 'transit queue lineId');
    const directionKey = requireNonEmptyString(queue.directionKey, 'transit queue directionKey');
    const key = `${stopId}|${lineId}|${directionKey}`;
    if (queueKeys.has(key)) throw new Error(`duplicate transit passenger queue: ${key}`);
    queueKeys.add(key);
    if (!stopIds.has(stopId) || !lineIds.has(lineId)) throw new Error('invalid transit queue reference');
    for (const cohort of requireArray(queue.cohorts, 'transit queue cohorts')) validateCohort(cohort, 'transit queue cohort');
  }
  for (const raw of requireArray(vehicles.vehicles, 'transit vehicles')) {
    const vehicle = requireRecord(raw, 'transit vehicle');
    const lineId = requireNonEmptyString(vehicle.lineId, 'transit vehicle lineId');
    if (!lineIds.has(lineId)) throw new Error('invalid transit vehicle line reference');
    for (const cohort of requireArray(vehicle.onboard, 'transit vehicle onboard')) validateCohort(cohort, 'onboard transit cohort');
  }
  const operationLines = new Set<string>();
  for (const raw of requireArray(operations.lines, 'transit operation lines')) {
    const row = requireRecord(raw, 'transit operation line');
    const lineId = requireNonEmptyString(row.lineId, 'transit operation lineId');
    if (!lineIds.has(lineId)) throw new Error('invalid transit operations line reference');
    if (operationLines.has(lineId)) throw new Error(`duplicate transit operations line: ${lineId}`);
    operationLines.add(lineId);
  }
}

function validateEconomyState(root: Record<string, unknown>): void {
  if (!isRecord(root.economyDomain)) return;
  const economy = root.economyDomain;
  const inventories = requireRecord(economy.inventories, 'economyDomain.inventories');
  const inventoryKeys = new Set<string>();
  for (const raw of requireArray(inventories.records, 'economy inventory records')) {
    const row = requireRecord(raw, 'economy inventory record');
    const firmId = requireNonEmptyString(row.firmId, 'economy inventory firmId');
    const commodity = requireNonEmptyString(row.commodity, 'economy inventory commodity');
    const key = `${firmId}|${commodity}`;
    if (inventoryKeys.has(key)) throw new Error(`duplicate economy inventory record: ${key}`);
    inventoryKeys.add(key);
  }
  const shipmentIds = new Set<string>();
  for (const raw of requireArray(inventories.cargo, 'economy cargo')) {
    const cargo = requireRecord(raw, 'economy cargo row');
    const token = requireRecord(cargo.token, 'economy cargo token');
    const shipmentId = requireNonEmptyString(token.shipmentId, 'economy cargo shipmentId');
    if (shipmentIds.has(shipmentId)) throw new Error(`duplicate economy cargo shipment: ${shipmentId}`);
    shipmentIds.add(shipmentId);
  }
  const financialFirmIds = new Set<string>();
  for (const raw of requireArray(economy.financials, 'economy financials')) {
    const row = requireRecord(raw, 'economy financial row');
    const firmId = requireNonEmptyString(row.firmId, 'economy financial firmId');
    if (financialFirmIds.has(firmId)) throw new Error(`duplicate economy financial firm reference: ${firmId}`);
    financialFirmIds.add(firmId);
  }
}

function validateUrbanFabricReferences(core: SimulationCore, assignments: readonly ParcelZoningAssignment[], buildings: readonly BuildingV2[], propertyMarket: PropertyMarketSnapshot, historicalParcelIds: ReadonlySet<string>): void {
  const requireParcel = (parcelId: string, source: string): void => { if (!core.cadastre.getParcel(parcelId)) throw new Error(`${source} references missing parcel: ${parcelId}`); };
  const requireHistoricalParcel = (parcelId: string, source: string): void => {
    if (!core.cadastre.getParcel(parcelId) && !historicalParcelIds.has(parcelId)) throw new Error(`${source} references unknown parcel history: ${parcelId}`);
  };
  for (const assignment of assignments) requireParcel(assignment.parcelId, 'zoning assignment');
  for (const building of buildings) for (const parcelId of building.parcelIds) requireParcel(parcelId, `building ${building.id}`);
  for (const holding of propertyMarket.holdings) requireParcel(holding.parcelId, 'property holding');
  for (const transaction of propertyMarket.transactions) for (const parcelId of transaction.parcelIds) requireHistoricalParcel(parcelId, `property transaction ${transaction.id}`);
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}
function requireArray(value: unknown, name: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array`);
  return value;
}
function requireNonEmptyString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) throw new Error(`${name} must be a non-empty string`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
