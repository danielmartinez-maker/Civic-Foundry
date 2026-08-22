import test from 'node:test';
import assert from 'node:assert/strict';
import { InventorySystem } from '../src/simulation/economy/InventorySystem.ts';
import { ProductionSystem } from '../src/simulation/economy/ProductionSystem.ts';
import type { Firm } from '../src/simulation/economy/FirmSystem.ts';

const base: Firm = { id: 'firm:m', buildingId: 'b:m', zone: 'industrial', archetype: 'light_manufacturing', status: 'operating', jobCapacity: 10, filledJobs: 10, vacancies: 0, productivity: 1, cashHealth: 0.5, consecutiveLossCycles: 0, consecutiveRecoveryCycles: 0, formationTick: 0, lastOperatingMargin: 0 };
const wholesaler: Firm = { ...base, id: 'firm:w', buildingId: 'b:w', zone: 'commercial', archetype: 'wholesale_logistics' };
const retailer: Firm = { ...base, id: 'firm:r', buildingId: 'b:r', zone: 'commercial', archetype: 'retail_local' };

test('manufacturer produces no goods without industrial inputs', () => {
  const inventories = new InventorySystem();
  const result = new ProductionSystem().runFirmCycle(base, inventories, { utilityRatio: 1, serviceRatio: 1, localDemand: 1 });
  assert.equal(result.produced.manufactured_goods ?? 0, 0);
  assert.ok(result.lostOutputFromInputShortage > 0);
});

test('wholesale conversion is one-to-one', () => {
  const inventories = new InventorySystem();
  inventories.seed(wholesaler.id, 'manufactured_goods', 12);
  const result = new ProductionSystem().runFirmCycle(wholesaler, inventories, { utilityRatio: 1, serviceRatio: 1, localDemand: 1 });
  assert.equal(result.consumed.manufactured_goods, result.produced.consumer_goods);
});

test('retail consumes consumer goods only when demand exists', () => {
  const inventories = new InventorySystem();
  inventories.seed(retailer.id, 'consumer_goods', 10);
  const noDemand = new ProductionSystem().runFirmCycle(retailer, inventories, { utilityRatio: 1, serviceRatio: 1, localDemand: 0 });
  assert.equal(noDemand.consumed.consumer_goods ?? 0, 0);
});

test('shipment cargo can be delivered only once', () => {
  const inventories = new InventorySystem();
  inventories.seed('firm:s', 'manufactured_goods', 10);
  const token = inventories.dispatchCargo('firm:s', 'manufactured_goods', 6, 'shipment:1');
  assert.equal(inventories.get('firm:s', 'manufactured_goods').onHand, 4);
  inventories.receiveCargo('firm:d', token);
  assert.equal(inventories.get('firm:d', 'manufactured_goods').onHand, 6);
  assert.throws(() => inventories.receiveCargo('firm:d', token));
});

test('cancelled local cargo returns to source exactly once', () => {
  const inventories = new InventorySystem();
  inventories.seed('firm:s', 'manufactured_goods', 10);
  const token = inventories.dispatchCargo('firm:s', 'manufactured_goods', 6, 'shipment:2');
  inventories.cancelCargo(token);
  assert.equal(inventories.get('firm:s', 'manufactured_goods').onHand, 10);
  assert.throws(() => inventories.cancelCargo(token));
});
