import type { SimulationCore } from '../simulation/core/SimulationCore.ts';
import type { EconomySchedulerStateSnapshot } from '../simulation/economy/EconomyScheduler.ts';
import { hydrateCoreV5, serializeCoreV5, type SaveV5 } from './saveV5.ts';

export type SaveV6 = Omit<SaveV5, 'saveVersion' | 'gameVersion'> & {
  saveVersion: 6;
  gameVersion: '0.6.0-metropolitan';
  economyDomain: EconomySchedulerStateSnapshot;
};

export function serializeCoreV6(core: SimulationCore): SaveV6 {
  const v5 = serializeCoreV5(core);
  return {
    ...v5,
    saveVersion: 6,
    gameVersion: '0.6.0-metropolitan',
    economyDomain: core.economyDomain.snapshotState(),
  };
}

export function hydrateCoreV6(input: unknown): SimulationCore {
  if (!isRecord(input)) throw new Error('save must be an object');
  if (input.saveVersion !== 6) return hydrateCoreV5(input);
  validateEnvelope(input);
  const save = input as unknown as SaveV6;
  const { economyDomain, ...v6WithoutEconomy } = save;
  const v5: SaveV5 = {
    ...v6WithoutEconomy,
    saveVersion: 5,
    gameVersion: '0.5.0-metropolitan',
  };
  const core = hydrateCoreV5(v5);
  validateEconomyReferences(core, economyDomain);
  core.economyDomain.restoreState(economyDomain);
  core.economyDomain.restoreDerivedContext(core.buildings.occupied());
  core.employmentSnapshot = { ...economyDomain.employment };

  const loads: Record<string, number> = { ...core.serviceVehicles.edgeLoads() };
  for (const [edgeId, load] of Object.entries(core.mobility.vehicles.edgeLoads())) loads[edgeId] = (loads[edgeId] ?? 0) + load;
  for (const [edgeId, load] of Object.entries(core.economyDomain.freightVehicles.edgeLoads())) loads[edgeId] = (loads[edgeId] ?? 0) + load;
  core.traffic.refreshMetrics(core.transportationGraph, loads);
  core.trafficSnapshot = core.trafficAnalytics.evaluate(core.traffic.edgeMetrics, core.traffic.recentOutcomes, core.traffic.activeVehicles.length);
  return core;
}

function validateEnvelope(record: Record<string, unknown>): void {
  if (record.gameVersion !== '0.6.0-metropolitan') throw new Error('invalid V6 game version');
  const economy = requireRecord(record.economyDomain, 'economyDomain');
  requireRecord(economy.firms, 'economyDomain.firms');
  requireRecord(economy.inventories, 'economyDomain.inventories');
  requireRecord(economy.trade, 'economyDomain.trade');
  requireRecord(economy.orders, 'economyDomain.orders');
  requireRecord(economy.freightVehicles, 'economyDomain.freightVehicles');
  if (!Array.isArray(economy.financials)) throw new Error('economyDomain.financials must be an array');
}

function validateEconomyReferences(core: SimulationCore, state: EconomySchedulerStateSnapshot): void {
  const firmIds = new Set(state.firms.firms.map((firm) => firm.id));
  if (firmIds.size !== state.firms.firms.length) throw new Error('duplicate economy firm');
  const buildings = new Map(core.buildings.list().map((building) => [building.id, building] as const));
  const gatewayIds = new Set(state.trade.gateways.map((gateway) => gateway.id));
  const orderIds = new Set(state.orders.orders.map((order) => order.id));
  const shipmentIds = new Set(state.freightVehicles.vehicles.map((vehicle) => vehicle.shipment.id));

  for (const firm of state.firms.firms) {
    const building = buildings.get(firm.buildingId);
    if (firm.status !== 'closed' && (!building || building.zone !== firm.zone)) throw new Error('invalid economy firm building reference');
    if (building && building.zone !== firm.zone) throw new Error('invalid economy firm building reference');
  }
  const financialFirmIds = new Set<string>();
  for (const row of state.financials) {
    if (!firmIds.has(row.firmId)) throw new Error('invalid economy financial firm reference');
    if (financialFirmIds.has(row.firmId)) throw new Error('duplicate economy financial firm reference');
    financialFirmIds.add(row.firmId);
    if (Object.values(row.values).some((value) => !Number.isFinite(value))) throw new Error('invalid economy financial value');
  }
  for (const item of state.inventories.records) {
    if (!firmIds.has(item.firmId)) throw new Error('invalid economy inventory firm reference');
    const values = Object.values(item.record);
    if (values.some((value) => !Number.isFinite(value) || value < 0)) throw new Error('invalid economy inventory value');
  }
  for (const cargo of state.inventories.cargo) {
    if (!Number.isFinite(cargo.token.quantity) || cargo.token.quantity < 0) throw new Error('invalid economy cargo quantity');
    if (cargo.token.sourceFirmId && !firmIds.has(cargo.token.sourceFirmId)) throw new Error('invalid economy cargo firm reference');
    if (!shipmentIds.has(cargo.token.shipmentId)) throw new Error('invalid economy cargo shipment reference');
  }
  for (const order of state.orders.orders) {
    if (order.destinationKind === 'firm' && !firmIds.has(order.destinationId)) throw new Error('invalid freight order firm reference');
    if (order.destinationKind === 'gateway' && !gatewayIds.has(order.destinationId)) throw new Error('invalid freight order gateway reference');
    if (order.originFirmId && !firmIds.has(order.originFirmId)) throw new Error('invalid freight order origin firm reference');
  }
  for (const vehicle of state.freightVehicles.vehicles) {
    if (!orderIds.has(vehicle.shipment.orderId)) throw new Error('invalid freight shipment order reference');
    if (vehicle.shipment.originKind === 'firm' && !firmIds.has(vehicle.shipment.originId)) throw new Error('invalid freight shipment origin firm reference');
    if (vehicle.shipment.originKind === 'gateway' && !gatewayIds.has(vehicle.shipment.originId)) throw new Error('invalid freight shipment origin gateway reference');
    if (vehicle.shipment.destinationKind === 'firm' && !firmIds.has(vehicle.shipment.destinationId)) throw new Error('invalid freight shipment destination firm reference');
    if (vehicle.shipment.destinationKind === 'gateway' && !gatewayIds.has(vehicle.shipment.destinationId)) throw new Error('invalid freight shipment destination gateway reference');
    for (const edgeId of vehicle.routeEdgeIds) if (!core.transportationGraph.getEdge(edgeId)) throw new Error(`invalid freight road reference: ${edgeId}`);
  }
}

function requireRecord(value: unknown, name: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${name} must be an object`);
  return value;
}
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
